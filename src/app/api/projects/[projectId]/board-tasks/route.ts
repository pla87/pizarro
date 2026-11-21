import { canAccessProject } from "@/lib/access-cache";
import { loadProjectBoardTasks } from "@/lib/board";
import { liveCursor } from "@/lib/realtime";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";
import { LIVE_PATCH_MAX } from "@/components/board/livePatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tarjetas sueltas del tablero (`?ids=a,b,c`, como mucho LIVE_PATCH_MAX): las que otra persona acaba de cambiar, que la
 * pestaña aplica sin recargar el tablero entero (Board.tsx, livePatch.ts). Solo las activas de ESTE proyecto, que el
 * usuario debe poder ver: las que no salen (borradas, archivadas, de otro proyecto o inexistentes) el tablero las quita.
 * `boot`: proceso del servidor (si ha cambiado, la pestaña recarga entero). No se registra en los logs.
 */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response((await getT())("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response((await getT())("No encontrado"), { status: 404 });
  // El mismo criterio que el canal en vivo (visibleProjectsWhere), con la caché breve que vacían las revocaciones.
  if (!(await canAccessProject(user, parsed.data))) return new Response((await getT())("No encontrado"), { status: 404 });
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").filter(Boolean))];
  if (!ids.length || ids.length > LIVE_PATCH_MAX || ids.some((id) => !v.id.safeParse(id).success)) {
    return new Response((await getT())("Datos no válidos"), { status: 400 });
  }
  const projectId = parsed.data;
  const tasks = await loadProjectBoardTasks(projectId, ids);
  return Response.json({ boot: liveCursor(projectId).boot, tasks }, { headers: { "Cache-Control": "no-store" } });
}
