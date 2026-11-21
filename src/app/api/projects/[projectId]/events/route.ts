import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { closePresenceStream, openPresenceStream, presenceJson, subscribePresence } from "@/lib/presence";
import { liveCursor, MAX_STREAMS_PER_USER, openStreamCount, registerStream, subscribeProject } from "@/lib/realtime";
import { currentSessionId, getCurrentUser, type CurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { isShuttingDown } from "@/lib/shutdown";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// Red de seguridad: aunque se haya escapado algún aviso de revocación, cada canal vuelve a comprobar su acceso. Las
// revocaciones (desactivar, cambiar el rol, cerrar sesiones, quitar del proyecto, cambiar la visibilidad o borrarlo)
// ya cortan el canal al momento (revoke.ts); esto cubre sobre todo las sesiones que caducan solas.
const RECHECK_MS = 5 * 60_000;

/** ¿La sesión sigue viva, el usuario activo y el proyecto visible para él? (consultas baratas, sin cookies) */
async function stillAllowed(sessionId: string, projectId: string): Promise<boolean> {
  // Camino corriente (miembro del proyecto): una sola consulta con la sesión, el usuario y su pertenencia.
  const member = await db.session.count({
    where: { id: sessionId, expiresAt: { gt: new Date() }, user: { active: true, memberships: { some: { projectId } } } },
  });
  if (member > 0) return true;
  // Administradores en proyectos de equipo sin ser miembros: la comprobación completa.
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { expiresAt: true, user: { select: { id: true, role: true, active: true } } },
  });
  if (!session || !session.user.active || session.expiresAt.getTime() < Date.now()) return false;
  const visible = visibleProjectsWhere({ id: session.user.id, role: session.user.role } as CurrentUser);
  return (await db.project.count({ where: { id: projectId, ...visible } })) > 0;
}

/** Canal de avisos (Server-Sent Events): «ha cambiado algo en el proyecto». No se registra en los logs. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  // Apagado del servidor en marcha: el navegador reintenta enseguida y se encuentra con la instancia nueva.
  if (isShuttingDown()) return new Response(null, { status: 503, headers: { "Retry-After": "3" } });
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });

  if (openStreamCount(user.id) >= MAX_STREAMS_PER_USER) return new Response(t("Demasiadas conexiones abiertas."), { status: 429 });
  const sessionId = await currentSessionId();
  if (!sessionId) return new Response(t("No autorizado"), { status: 401 });
  // La pestaña se cerró (o el canal se cortó) mientras se comprobaba todo lo anterior: la señal ya no avisará y Next no
  // cancelaría el flujo, así que no se registra nada (si no, quedaba una persona fantasma y un hueco de canal ocupado).
  if (req.signal.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const unregister = registerStream({ userId: user.id, projectId: project.id, sessionId, close: () => cleanup() });
      if (!unregister) {
        // Carrera con otra apertura simultánea: se supera el máximo, se cierra el canal.
        controller.close();
        return;
      }
      send("retry: 3000\n\n");
      // Presencia: la pestaña cuenta como «tablero a la vista» mientras el canal esté abierto. El id del canal va en el
      // saludo: el diálogo de una tarea lo usa para anunciarla una sola vez (api/tasks/[id]/viewers?stream=…).
      const streamId = openPresenceStream(project.id, user.id, user.name);
      let lastPresence = "";
      // El estado llega ya en JSON, calculado una vez por proyecto (presence.ts); aquí solo se descarta si no ha cambiado.
      const sendPresence = (json: string) => {
        if (json === lastPresence) return;
        lastPresence = json;
        send(`event: presence\ndata: ${json}\n\n`);
      };
      const unsubscribe = subscribeProject(project.id, (c) => send(`event: change\ndata: ${JSON.stringify({ userId: c.userId, action: c.action, taskId: c.taskId ?? null, ...(c.taskIds ? { taskIds: c.taskIds } : {}), ...(c.full ? { full: true } : {}), at: c.at, seq: c.seq, cid: c.cid })}\n\n`));
      // Saludo: último aviso publicado en el proyecto. La pestaña que reabre el canal (estuvo oculta o se cortó) sabe así si
      // se perdió alguno y solo entonces pide el tablero (ver Board.tsx).
      send(`event: hello\ndata: ${JSON.stringify({ ...liveCursor(project.id), stream: streamId })}\n\n`);
      // Estado completo de la presencia al conectar; después, solo cuando cambia.
      sendPresence(presenceJson(project.id));
      const unsubscribePresence = subscribePresence(project.id, sendPresence);
      // Evento periódico con nombre (no un comentario: el navegador no los ve): mantiene viva la conexión a través de
      // proxies y le dice a la pestaña que el canal está sano (con él, el respaldo del tablero se espacia: Board.tsx).
      // Quién deja de contar como activo (5 minutos sin actividad) lo comprueba presence.ts una vez por proyecto.
      const ping = setInterval(() => send(`event: ping\ndata: ${Date.now()}\n\n`), PING_MS);
      let checking = false;
      const recheck = setInterval(() => {
        if (checking) return;
        checking = true;
        stillAllowed(sessionId, project.id)
          .then((ok) => {
            if (!ok) cleanup();
          })
          .catch(() => {
            // Fallo transitorio de BD: se reintenta en el siguiente ciclo.
          })
          .finally(() => (checking = false));
      }, RECHECK_MS);
      cleanup = () => {
        clearInterval(ping);
        clearInterval(recheck);
        unsubscribe();
        unsubscribePresence();
        closePresenceStream(streamId);
        unregister();
        try {
          controller.close();
        } catch {
          // Ya cerrado.
        }
      };
      req.signal.addEventListener("abort", () => cleanup(), { once: true });
      // Cortada justo ahora (entre la comprobación de arriba y el registro): el aviso ya no llegará.
      if (req.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
