import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { generateProjectReportPdf } from "@/lib/report-build";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { toLocale } from "@/i18n/core";

export const runtime = "nodejs";

/** Informe PDF del estado del proyecto (resumen, pendiente por columna, plazos, entregables, carga por persona y releases). */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const start = performance.now();
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(`report:${user.id}`, 20, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  const { projectId } = await ctx.params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true },
  });
  if (!project) return new Response(t("No encontrado"), { status: 404 });

  let report;
  try {
    report = await generateProjectReportPdf(projectId, { generatedBy: user.name, locale: toLocale(user.locale) });
  } catch (err) {
    logEvent({
      level: "error", category: "api", action: "report.pdfFailed", message: `Fallo al generar el informe PDF de «${project.name}»: ${err instanceof Error ? err.message : String(err)}`,
      userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/report`, ip: clientIp(_req.headers), durationMs: performance.now() - start,
    });
    throw err;
  }
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `Informe PDF generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
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
