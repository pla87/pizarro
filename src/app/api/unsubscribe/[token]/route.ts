import { logError, logEvent } from "@/lib/log";
import { rateIp, rateLimit, rateLimitRetryAfterSec } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { applyUnsubscribe } from "@/lib/unsubscribe";
import { BodyTooLargeError, readBodyLimited } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Baja en un clic (RFC 8058) de los emails de avisos, del resumen diario y del informe semanal (lib/unsubscribe.ts).
// Pública: sin sesión (el gestor de correo hace el POST desde sus servidores); el token firmado es la credencial y solo
// sirve para apagar un tipo de email. Nunca da de baja con un GET: los escáneres de enlaces abren todos los de un email.
// El token no se anota en los registros (ni la ruta) y la respuesta no dice a qué dirección iba el email.

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const PER_IP = { limit: 30, windowMs: 10 * 60_000 };
const PER_TOKEN = { limit: 10, windowMs: 10 * 60_000 };
/** «List-Unsubscribe=One-Click» o el formulario de la página: cuerpos de unos pocos bytes. */
const MAX_BODY = 4096;

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", ...extra } });

/** Página de confirmación (ruta relativa: detrás de un proxy la URL interna no es la que ve el navegador). */
const toPage = (token: string) => new Response(null, { status: 303, headers: { ...NO_STORE, Location: `/unsubscribe/${encodeURIComponent(token)}` } });

/** Abrir la dirección de la cabecera (un gestor sin baja en un clic la abre en el navegador): a la página, que pide confirmar. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return toPage((await ctx.params).token);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req.headers);
  const start = performance.now();
  try {
    const { token } = await ctx.params;
    const tokenKey = `unsub:token:${token.slice(0, 100)}`;
    // Retry-After del límite que ha fallado (el de la IP no toca el contador del token).
    const ipKey = `unsub:ip:${rateIp(ip)}`;
    const blocked = !rateLimit(ipKey, PER_IP.limit, PER_IP.windowMs) ? ipKey : !rateLimit(tokenKey, PER_TOKEN.limit, PER_TOKEN.windowMs) ? tokenKey : null;
    if (blocked) return text("Too many requests", 429, { "Retry-After": String(rateLimitRetryAfterSec(blocked)) });
    const type = req.headers.get("content-type") ?? "";
    const form = type.startsWith("multipart/form-data")
      ? await readBodyLimited(req, MAX_BODY, "formData")
      : new URLSearchParams(await readBodyLimited(req, MAX_BODY, "text"));
    const oneClick = form.get("List-Unsubscribe") === "One-Click";
    const fromPage = form.get("confirm") === "1";
    if (!oneClick && !fromPage) return text("Bad request", 400);
    const done = await applyUnsubscribe(token, oneClick ? "one-click" : "page", ip);
    // El botón de la página vuelve a ella, que dice cómo ha quedado (o que el enlace no vale).
    if (fromPage && !oneClick) return toPage(token);
    return done ? text("Unsubscribed", 200) : text("Not found", 404);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return text("Payload too large", 413);
    logEvent({ level: "error", category: "api", action: "notify.unsubscribeFailed", label: { k: "Fallo al dar de baja un email: {error}", p: { error: logError(err) } }, path: "/api/unsubscribe/…", ip, durationMs: performance.now() - start });
    return text("Internal error", 500);
  }
}
