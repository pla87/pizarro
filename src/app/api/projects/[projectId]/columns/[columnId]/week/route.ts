import { authorizeColumnRoute, pdfResponse } from "@/lib/column-route";
import { PdfTimeoutError, generateWeekPlanPdf } from "@/lib/report-build";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

/** PDF de la semana de una columna «Planificación semanal»: `?by=day` (por defecto) o `?by=person`. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const auth = await authorizeColumnRoute(ctx.params);
  if (auth instanceof Response) return auth;
  const { user, t, locale, projectId, columnId, project } = auth;
  const groupBy = new URL(req.url).searchParams.get("by") === "person" ? "person" : "day";
  const report = await generateWeekPlanPdf(projectId, columnId, { generatedBy: user.name, locale, groupBy }).catch((err) => { if (err instanceof PdfTimeoutError) return err; throw err; });
  if (report instanceof PdfTimeoutError) return new Response(t(report.message), { status: report.status });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `PDF de la semana generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/week`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length, groupBy },
  });
  return pdfResponse(report.pdf, report.filename);
}
