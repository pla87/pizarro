import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { MAX_STREAMS_PER_USER, openStreamCount, registerStream, subscribeProject } from "@/lib/realtime";
import { currentSessionId, getCurrentUser, type CurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// Red de seguridad: aunque se haya escapado algún aviso de revocación, cada canal vuelve a comprobar su acceso.
const RECHECK_MS = 60_000;

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
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });

  if (openStreamCount(user.id) >= MAX_STREAMS_PER_USER) return new Response(t("Demasiadas conexiones abiertas."), { status: 429 });
  const sessionId = await currentSessionId();
  if (!sessionId) return new Response(t("No autorizado"), { status: 401 });

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
      const unsubscribe = subscribeProject(project.id, (c) => send(`event: change\ndata: ${JSON.stringify({ userId: c.userId, action: c.action, at: c.at, cid: c.cid })}\n\n`));
      // Comentario periódico: mantiene viva la conexión a través de proxies.
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
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
        unregister();
        try {
          controller.close();
        } catch {
          // Ya cerrado.
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
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
