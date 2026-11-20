import { canAccessProject, projectOfTask } from "@/lib/access-cache";
import { holdTaskView, leaveTask, notePresence, noteTaskViewer, releaseTaskView, taskViewersExcept } from "@/lib/presence";
import { rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(ctx: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const parsed = v.id.safeParse((await ctx.params).taskId);
  if (!parsed.success) return null;
  // Proyecto de la tarea y acceso, ambos con caché breve.
  const projectId = await projectOfTask(parsed.data);
  return projectId && (await canAccessProject(user, projectId)) ? { user, taskId: parsed.data, projectId } : null;
}

/** Id del canal en vivo de la pestaña (`?stream=`, lo da el saludo del canal), o null. */
function streamParam(req: Request): string | null {
  const s = new URL(req.url).searchParams.get("stream");
  return s && /^[0-9a-f-]{36}$/.test(s) ? s : null;
}

/**
 * Id del montaje del diálogo (`?open=`, lo elige el diálogo al abrirse): el GET y el DELETE de un mismo montaje llevan el
 * mismo, así el cierre de uno no quita la tarea que ha vuelto a abrir otro. Sin él (una pestaña con la versión anterior),
 * todos sus montajes cuentan como uno, como antes.
 */
function openParam(req: Request): string {
  const s = new URL(req.url).searchParams.get("open");
  return s && /^[A-Za-z0-9]{1,16}$/.test(s) ? s : "";
}

/**
 * El diálogo de la tarea avisa de que está abierta y recibe quién más la tiene abierta. No se registra en los logs, pero
 * cuenta como actividad en el tablero («Quién está trabajando»).
 *
 * Con `?stream=<id del canal en vivo de la pestaña>&open=<id del montaje del diálogo>` basta un aviso al abrir: la tarea
 * cuenta como abierta hasta que se cierra ese montaje del diálogo (DELETE con los mismos parámetros) o el canal, y los cambios llegan por el canal (evento `presence`). Sin canal (no soportado o
 * caído), el diálogo repite el aviso cada 60 s y cada aviso vale 150 s.
 */
export async function GET(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const found = await load(ctx);
  if (!found) return new Response((await getT())("No encontrado"), { status: 404 });
  // Cada anuncio puede añadir una tarea o un montaje en memoria (con tope en presence.ts): también con tope de ritmo.
  if (!rateLimit(`viewers:${found.user.id}`, 120, 60_000)) return new Response((await getT())("Demasiadas peticiones"), { status: 429, headers: { "Retry-After": "60" } });
  notePresence(found.projectId, found.user.id, found.user.name);
  const stream = streamParam(req);
  const held = stream !== null && holdTaskView(stream, found.user.id, found.taskId, found.projectId, openParam(req));
  const others = held
    ? taskViewersExcept(found.taskId, found.projectId, found.user.id)
    : noteTaskViewer(found.taskId, found.projectId, found.user.id, found.user.name);
  return Response.json({ others, live: held }, { headers: { "Cache-Control": "no-store" } });
}

/** El diálogo se ha cerrado. */
export async function DELETE(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  // Modifica estado (la presencia): misma comprobación de origen que el resto de rutas que escriben.
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const found = await load(ctx);
  // Tope de ritmo también aquí: cada cierre con un `open` desconocido se apunta unos segundos (cierres adelantados).
  if (found && rateLimit(`viewers-close:${found.user.id}`, 240, 60_000)) {
    const stream = streamParam(req);
    if (stream) releaseTaskView(stream, found.user.id, found.taskId, openParam(req));
    // También el aviso con caducidad: con `?stream=` el GET pudo caer en él (canal desconocido, p. ej. ya cerrado).
    // Solo avisa a los canales si la persona estaba anotada.
    leaveTask(found.taskId, found.user.id);
  }
  return new Response(null, { status: 204 });
}
