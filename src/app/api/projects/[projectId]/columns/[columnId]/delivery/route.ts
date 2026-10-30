import { authorizeColumnRoute, pdfResponse } from "@/lib/column-route";
import { PdfTimeoutError, generateDeliveryPdf } from "@/lib/report-build";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

/** PDF «Resumen para el cliente» de una columna «Entrega al cliente». */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const auth = await authorizeColumnRoute(ctx.params);
  if (auth instanceof Response) return auth;
  const { user, t, locale, projectId, columnId, project } = auth;
  const report = await generateDeliveryPdf(projectId, columnId, { locale }).catch((err) => { if (err instanceof PdfTimeoutError) return err; throw err; });
  if (report instanceof PdfTimeoutError) return new Response(t(report.message), { status: report.status });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `PDF de entrega al cliente generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/delivery`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length },
  });
  return pdfResponse(report.pdf, report.filename);
}
