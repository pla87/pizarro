import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { generateProjectReportPdf, isPdfQueueError, PDF_BUSY_MESSAGE } from "@/lib/report-build";
import { logError, logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { isRowId } from "@/lib/row-id";
import { getT } from "@/i18n/server";
import { toLocale } from "@/i18n/core";
import { logSize } from "@/lib/format-size";

export const runtime = "nodejs";

/** Informe PDF del estado del proyecto (resumen, pendiente por columna, plazos, entregables, carga por persona y releases). */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const start = performance.now();
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(`project-report:${user.id}`, 5, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  const { projectId } = await ctx.params;
  // Un id mal formado (el carácter nulo, p. ej.) no existe: 404 sin llegar a PostgreSQL, que fallaba con un 500.
  if (!isRowId(projectId)) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true },
  });
  if (!project) return new Response(t("No encontrado"), { status: 404 });

  let report;
  try {
    report = await generateProjectReportPdf(projectId, { generatedBy: user.name, locale: toLocale(user.locale), signal: _req.signal });
  } catch (err) {
    // Cola llena o petición cancelada: no es un fallo de generación, no se registra como tal.
    if (isPdfQueueError(err) && err.code === "pdf_busy") return new Response(t(PDF_BUSY_MESSAGE), { status: err.status });
    if (isPdfQueueError(err) && err.code === "pdf_aborted") return new Response(t(err.message), { status: err.status });
    logEvent({
      level: "error", category: "api", action: "report.pdfFailed", label: { k: "Fallo al generar el informe PDF de «{project}»: {error}", p: { project: project.name, error: logError(err) } },
      userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/report`, ip: clientIp(_req.headers), durationMs: performance.now() - start,
    });
    if (isPdfQueueError(err)) return new Response(t(err.message), { status: err.status });
    throw err;
  }
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", label: { k: "Informe PDF generado de «{project}» ({size})", p: { project: project.name, size: logSize(report.pdf.length) } },
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/report`, ip: clientIp(_req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length },
  });
  return new Response(new Uint8Array(report.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${report.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
