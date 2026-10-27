import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { generateWeekPlanPdf } from "@/lib/report-build";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { toLocale } from "@/i18n/core";

export const runtime = "nodejs";

/** PDF de la semana de una columna «Planificación semanal»: `?by=day` (por defecto) o `?by=person`. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(`report:${user.id}`, 5, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  const { projectId, columnId } = await ctx.params;
  const project = await db.project.findFirst({ where: { id: projectId, ...visibleProjectsWhere(user) }, select: { id: true, name: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });
  const groupBy = new URL(req.url).searchParams.get("by") === "person" ? "person" : "day";
  const report = await generateWeekPlanPdf(projectId, columnId, { generatedBy: user.name, locale: toLocale(user.locale), groupBy });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `PDF de la semana generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/week`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length, groupBy },
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
