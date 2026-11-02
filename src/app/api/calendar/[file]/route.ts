import { createHash } from "node:crypto";
import { buildFeedIcs, resolveFeedToken } from "@/lib/calendar-feed";
import { feedRateKey, tokenFromFilename } from "@/lib/calendar-feed-core";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit, rateLimitRetryAfterSec } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

/** Mismo cuerpo y cabeceras para todo lo que no vale (token ajeno, regenerado, desactivado, usuario inactivo…): no revela si existe. */
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const PER_IP = { limit: 300, windowMs: 10 * 60_000 };
const PER_TOKEN = { limit: 30, windowMs: 10 * 60_000 };

/**
 * Suscripción al calendario (.ics vivo) de una persona: /api/calendar/<token>.ics. Pública (sin sesión; el token es la
 * credencial); los permisos se evalúan en cada petición. El token nunca se anota en los registros.
 */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  const { file } = await ctx.params;
  const token = tokenFromFilename(file);
  // Límite por IP (cuenta todo, también lo que no vale) y por token.
  const tooMany = (key: string, cfg: { limit: number; windowMs: number }) => !rateLimit(key, cfg.limit, cfg.windowMs);
  const ipKey = `calfeed:ip:${ip}`;
  const tokenKey = feedRateKey(token ?? file);
  if (tooMany(ipKey, PER_IP) || tooMany(tokenKey, PER_TOKEN)) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rateLimitRetryAfterSec(tokenKey)), "Cache-Control": "no-store" } });
  }
  const feed = token ? await resolveFeedToken(token) : null;
  if (!feed) return notFound();

  const { ics, tasks, deliverables } = await buildFeedIcs(feed.user, feed.scope);
  // Aviso de uso: como mucho una escritura por hora y enlace.
  void db.calendarFeed.updateMany({ where: { id: feed.feedId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 3_600_000) } }] }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  logEvent({
    category: "api", action: "calendar.feed", message: `Calendario suscrito consultado (${tasks} tareas, ${deliverables} entregables)`,
    userId: feed.user.id, userName: feed.user.name, path: "/api/calendar/…", ip, durationMs: performance.now() - start,
    details: { tasks, deliverables },
  });
  // Cada evento lleva como DTSTAMP su último cambio, así que un calendario igual da el mismo ETag (y 304).
  const etag = `"${createHash("sha256").update(ics).digest("base64url").slice(0, 27)}"`;
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="pizarro.ics"',
    "Cache-Control": "private, max-age=300",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": headers["Cache-Control"] } });
  return new Response(ics, { headers });
}
