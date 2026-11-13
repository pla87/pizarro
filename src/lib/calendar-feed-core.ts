import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { labelledHmac, labelledHmacCandidates } from "./keyring";

// Parte pura del enlace de suscripción al calendario (.ics vivo): token, hash, ventana de fechas y direcciones.

/** Bytes aleatorios del token (256 bits); en la dirección son 43 caracteres base64url. */
const FEED_TOKEN_BYTES = 32;
export const FEED_TOKEN_LENGTH = Math.ceil((FEED_TOKEN_BYTES * 8) / 6);
/** Ventana de fechas del calendario: desde hace tantos días hasta tantos días vista. */
export const FEED_PAST_DAYS = 60;
export const FEED_FUTURE_DAYS = 365;
/** Topes de eventos por calendario. */
export const FEED_MAX_TASKS = 2000;
export const FEED_MAX_DELIVERABLES = 500;
/** Cada cuántos minutos se sugiere a los clientes volver a consultar. */
export const FEED_REFRESH_MINUTES = 60;

export const newFeedToken = (): string => randomBytes(FEED_TOKEN_BYTES).toString("base64url");

/** Lo único que se guarda del token (HMAC con etiqueta propia: no vale como ningún otro token de la app). */
export const hashFeedToken = (token: string): string => labelledHmac("calendar-feed", token);
/** Hashes con los que buscar un token: el de la clave actual y, durante la rotación de TOKEN_SECRET, el de la anterior. */
export const feedTokenHashes = (token: string): string[] => labelledHmacCandidates("calendar-feed", token);

/** ¿Tiene la forma de un token nuestro? Descarta basura sin tocar la base de datos. */
export const isFeedTokenShape = (s: string): boolean => s.length === FEED_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(s);

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Clave corta para el limitador (el token en claro no se guarda ni en memoria). */
export const feedRateKey = (token: string): string => `calfeed:t:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;

/** Del nombre del archivo de la ruta (`<token>.ics`) al token; null si no acaba en .ics. */
export function tokenFromFilename(name: string): string | null {
  return name.endsWith(".ics") ? name.slice(0, -4) : null;
}

export const feedHttpsUrl = (appUrl: string, token: string): string => `${appUrl.replace(/\/$/, "")}/api/calendar/${token}.ics`;
export const feedWebcalUrl = (httpsUrl: string): string => httpsUrl.replace(/^https?:\/\//, "webcal://");
/** Abre Google Calendar con la suscripción lista para añadir. */
export const googleSubscribeUrl = (webcal: string): string => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

/** SEQUENCE de un evento: segundos desde 1970 del último cambio (sube con cada cambio y cabe en 32 bits hasta 2038). */
export const sequenceOf = (d: Date): number => Math.floor(d.getTime() / 1000);

/** Recorta a `max` caracteres (puntos de código: no parte un par sustituto, p. ej. un emoji) y añade «…». */
export const snippet = (s: string, max: number) => {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : s;
};

/**
 * Registro de la suscripción muestreado: los clientes de calendario consultan cada pocos minutos (aunque se les pida
 * cada hora), y anotar cada consulta llenaba Administración → Logs. Una consulta se anota la primera vez que se ve
 * una clave (enlace + IP: un enlace usado desde otro sitio sale enseguida), y después como mucho una vez cada
 * FEED_LOG_EVERY_MS, con cuántas se han callado desde la anterior. Los errores se anotan siempre.
 */
export const FEED_LOG_EVERY_MS = 6 * 3_600_000;
/** Claves recordadas como mucho (se olvidan las más antiguas: como mucho, una línea de más). */
const FEED_LOG_MAX_KEYS = 5000;

type FeedLogState = Map<string, { at: number; skipped: number }>;

/** ¿Toca anotar esta consulta? Si sí, devuelve cuántas se callaron desde la última anotada; si no, null. */
export function feedLogDue(state: FeedLogState, key: string, now: number, every = FEED_LOG_EVERY_MS): number | null {
  const prev = state.get(key);
  if (prev && now - prev.at < every) {
    prev.skipped++;
    return null;
  }
  // Al final del Map (orden de inserción): las más antiguas son las primeras en olvidarse.
  state.delete(key);
  state.set(key, { at: now, skipped: 0 });
  if (state.size > FEED_LOG_MAX_KEYS) state.delete(state.keys().next().value!);
  return prev?.skipped ?? 0;
}
