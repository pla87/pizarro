import { z } from "zod";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import { currentSessionId, getCurrentUser } from "@/lib/session";
import { deviceLabel } from "@/lib/user-agent";
import { PushSubscribeError, renewPushSubscription, vapidKeys } from "@/lib/web-push";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  oldHash: z.string().regex(/^[0-9a-f]{64}$/),
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Renovación de la suscripción push desde el service worker (evento `pushsubscriptionchange`, sin página abierta). Va con
 * la cookie de sesión: solo cambia una suscripción PROPIA de ESTA sesión, reconocida por la huella de la vieja
 * (renewPushSubscription); con otra huella, de otra persona o de otra sesión responde 404 y no toca nada. Mismo origen
 * obligatorio. Con 404/401 el service worker no insiste: al abrir la app, la resincronización lo intenta con la página.
 * GET devuelve la clave pública VAPID, para que el service worker pueda suscribirse cuando el navegador no le da la vieja.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: "No autorizado" }, 401);
  return json({ publicKey: (await vapidKeys()).publicKey }, 200);
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const user = await getCurrentUser();
  const sessionId = user ? await currentSessionId() : null;
  if (!user || !sessionId) return json({ error: "No autorizado" }, 401);
  if (!rateLimit(`messaging:push:renew:${user.id}`, 20, 10 * 60_000)) return new Response(null, { status: 429 });
  const raw = await req.text();
  if (raw.length > 4096) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  const ua = req.headers.get("user-agent") ?? "";
  try {
    await renewPushSubscription(user.id, sessionId, parsed.data.oldHash, { endpoint: parsed.data.endpoint, keys: parsed.data.keys }, ua);
  } catch (err) {
    if (!(err instanceof PushSubscribeError)) throw err;
    return json({ error: err.reason }, err.reason === "unknown" ? 404 : 400);
  }
  const t = await getT();
  logEvent({ category: "notify", action: "push.renew", userId: user.id, userName: user.name, label: { k: "Renovó los avisos push en {device}", p: { device: deviceLabel(ua, t) } } });
  return json({ ok: true }, 200);
}
