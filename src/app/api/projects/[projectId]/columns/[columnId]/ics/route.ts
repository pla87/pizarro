import { buildColumnIcs } from "@/lib/column-views";
import { authorizeColumnRoute } from "@/lib/column-route";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

/** Calendario .ics con las tareas con fecha límite de una columna «Agenda». */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; columnId: string }> }) {
  const start = performance.now();
  const auth = await authorizeColumnRoute(ctx.params);
  if (auth instanceof Response) return auth;
  const { user, t, projectId, columnId, project } = auth;
  const result = await buildColumnIcs(projectId, columnId);
  if (!result) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "column.ics", message: `Calendario .ics generado de «${project.name}» (${result.count} tareas)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/columns/${columnId}/ics`, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: result.count },
  });
  return new Response(result.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
