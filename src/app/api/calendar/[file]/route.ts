import { cachedFeedIcs, feedMaxAgeSec, resolveFeedToken } from "@/lib/calendar-feed";
import { FEED_LOG_EVERY_MS, feedLogDue, feedRateKey, tokenFromFilename } from "@/lib/calendar-feed-core";
import { db } from "@/lib/db";
import { ifNoneMatchHas } from "@/lib/etag";
import { logEvent } from "@/lib/log";
import { rateIp, rateLimit, rateLimitRetryAfterSec } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { maskSecretsFor } from "@/lib/secret-path";

export const runtime = "nodejs";

/** Mismo cuerpo y cabeceras para todo lo que no vale (token ajeno, regenerado, desactivado, usuario inactivo…): no revela si existe. */
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const PER_IP = { limit: 300, windowMs: 10 * 60_000 };
const PER_TOKEN = { limit: 30, windowMs: 10 * 60_000 };

/** Qué se ha anotado ya en el registro (muestreo: ver feedLogDue). Por proceso; al reiniciar, como mucho una línea más. */
const feedLog = new Map<string, { at: number; skipped: number }>();
/** Avisos de exceso de ritmo: como mucho uno por hora y enlace o IP (son lo que más interesa de seguridad). */
const RATE_LOG_EVERY_MS = 3_600_000;
/** «Último uso» del enlace: como mucho una escritura por hora; en memoria, cuándo se intentó por última vez en este proceso. */
const USED_EVERY_MS = 3_600_000;
const usedAt = new Map<string, number>();
function usedLogDue(key: string, now = Date.now()): boolean {
  const prev = usedAt.get(key);
  if (prev !== undefined && now - prev < USED_EVERY_MS && now >= prev) return false;
  usedAt.delete(key);
  usedAt.set(key, now);
  if (usedAt.size > 5000) usedAt.delete(usedAt.keys().next().value!);
  return true;
}

/**
 * Suscripción al calendario (.ics vivo) de una persona: /api/calendar/<token>.ics. Pública (sin sesión; el token es la
 * credencial). El enlace se comprueba en cada petición; el calendario ya hecho se guarda FEED_CACHE_MS (cachedFeedIcs),
 * así que un cambio de tareas o permisos se ve como mucho un minuto después. El token nunca se anota en los registros.
 */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  let file = "";
  try {
    file = (await ctx.params).file;
    return await serveFeed(req, file, ip, start);
  } catch (err) {
    // Cualquier fallo (BD, memoria…): 500 genérico y el error al registro sin el token (ni en la ruta ni en el mensaje).
    const message = maskSecretsFor(err instanceof Error ? err.message : String(err), `/api/calendar/${file}`);
    logEvent({ level: "error", category: "api", action: "calendar.feedFailed", message: `Fallo al servir el calendario suscrito: ${message}`, path: "/api/calendar/…", ip, durationMs: performance.now() - start });
    return new Response("Internal error", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

async function serveFeed(req: Request, file: string, ip: string, start: number): Promise<Response> {
  const token = tokenFromFilename(file);
  // Límite por IP (cuenta todo, también lo que no vale) y por token.
  const tooMany = (key: string, cfg: { limit: number; windowMs: number }) => !rateLimit(key, cfg.limit, cfg.windowMs);
  const ipKey = `calfeed:ip:${rateIp(ip)}`;
  const tokenKey = feedRateKey(token ?? file);
  if (tooMany(ipKey, PER_IP) || tooMany(tokenKey, PER_TOKEN)) {
    const skipped = feedLogDue(feedLog, `429|${tokenKey}|${ipKey}`, Date.now(), RATE_LOG_EVERY_MS);
    if (skipped !== null) {
      logEvent({
        level: "warn", category: "api", action: "calendar.feedRateLimited", message: "Calendario suscrito: demasiadas consultas seguidas (límite de ritmo)",
        path: "/api/calendar/…", ip, durationMs: performance.now() - start, details: { skipped },
      });
    }
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rateLimitRetryAfterSec(tokenKey)), "Cache-Control": "no-store" } });
  }
  const feed = token ? await resolveFeedToken(token) : null;
  if (!feed) {
    // Enlace regenerado o desactivado (el calendario lo sigue pidiendo), usuario inactivo o un token inventado: por IP.
    const skipped = feedLogDue(feedLog, `404|${ipKey}`, Date.now());
    if (skipped !== null) {
      logEvent({
        category: "api", action: "calendar.feedRejected", message: "Calendario suscrito: enlace no válido (regenerado, desactivado o de un usuario inactivo)",
        path: "/api/calendar/…", ip, durationMs: performance.now() - start, details: { skipped },
      });
    }
    return notFound();
  }

  // Guardado un minuto por enlace (cachedFeedIcs): un calendario que consulta a menudo, o varios a la vez, no lo rehacen.
  const { ics, etag, builtAt, tasks, deliverables, repeats } = await cachedFeedIcs(feed);
  // Aviso de uso: como mucho una escritura por hora y enlace (y, en este proceso, ni siquiera la consulta entre medias).
  // Por hash del token: al regenerar el enlace (lastUsedAt vuelve a null) el nuevo se anota en su primera consulta.
  if (usedLogDue(feed.tokenHash)) {
    void db.calendarFeed.updateMany({ where: { id: feed.feedId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - USED_EVERY_MS) } }] }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  // Muestreado: la primera consulta de cada enlace desde cada IP y luego como mucho una cada 6 h (los clientes de
  // calendario consultan cada pocos minutos). `skipped`: consultas correctas no anotadas desde la anterior.
  const skipped = feedLogDue(feedLog, `ok|${feed.feedId}|${rateIp(ip)}`, Date.now());
  if (skipped !== null) {
    logEvent({
      category: "api", action: "calendar.feed", message: `Calendario suscrito consultado (${tasks} tareas, ${deliverables} entregables)`,
      userId: feed.user.id, userName: feed.user.name, path: "/api/calendar/…", ip, durationMs: performance.now() - start,
      details: { tasks, deliverables, repeats, skipped, sampledEveryHours: FEED_LOG_EVERY_MS / 3_600_000 },
    });
  }
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="pizarro.ics"',
    // Lo que le queda en la memoria del servidor (≤ 60 s; antes 300 s fijos): entre las dos, como mucho un minuto.
    "Cache-Control": `private, max-age=${feedMaxAgeSec(builtAt)}`,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (ifNoneMatchHas(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": headers["Cache-Control"] } });
  return new Response(ics, { headers });
}
