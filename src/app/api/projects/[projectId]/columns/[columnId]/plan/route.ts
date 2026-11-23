import { authorizeColumnRoute, pdfResponse } from "@/lib/column-route";
import { isPdfQueueError, generateAssignPlanPdf } from "@/lib/report-build";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { logSize } from "@/lib/format-size";

export const runtime = "nodejs";

/** «Generar plan» de una columna «Asignación a persona»: PDF con las tareas de su persona, agrupadas por vencimiento. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const auth = await authorizeColumnRoute(ctx.params, "plan");
  if (auth instanceof Response) return auth;
  const { user, t, locale, projectId, columnId, project } = auth;
  const report = await generateAssignPlanPdf(projectId, columnId, { locale, signal: req.signal }).catch((err) => { if (isPdfQueueError(err)) return err; throw err; });
  if (report instanceof AppError) return new Response(t(report.message), { status: report.status });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", label: { k: "Plan de una columna de asignación generado de «{project}» ({size})", p: { project: project.name, size: logSize(report.pdf.length) } },
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/plan`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length },
  });
  return pdfResponse(report.pdf, report.filename);
}
