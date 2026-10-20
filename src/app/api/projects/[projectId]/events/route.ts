import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { subscribeProject } from "@/lib/realtime";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 25_000;

/** Canal de avisos (Server-Sent Events): «ha cambiado algo en el proyecto». No se registra en los logs. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });

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
      send("retry: 3000\n\n");
      const unsubscribe = subscribeProject(project.id, (c) => send(`event: change\ndata: ${JSON.stringify({ userId: c.userId, action: c.action, at: c.at })}\n\n`));
      // Comentario periódico: mantiene viva la conexión a través de proxies.
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
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
