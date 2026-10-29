import { authorizeColumnRoute, pdfResponse } from "@/lib/column-route";
import { generateChecklistPdf } from "@/lib/report-build";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

/** PDF de la lista consolidada de una columna «Lista consolidada»: `?by=card` (por defecto) o `?by=kind`. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const auth = await authorizeColumnRoute(ctx.params);
  if (auth instanceof Response) return auth;
  const { user, t, locale, projectId, columnId, project } = auth;
  const by = new URL(req.url).searchParams.get("by") === "kind" ? "kind" : "card";
  const report = await generateChecklistPdf(projectId, columnId, { locale, by });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `PDF de la lista consolidada generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/checklist`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { items: report.itemCount, bytes: report.pdf.length, by },
  });
  return pdfResponse(report.pdf, report.filename);
}
