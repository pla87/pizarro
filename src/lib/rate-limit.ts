// Limitador en memoria (suficiente para un único contenedor).
// En globalThis: acciones y rutas pueden empaquetarse por separado y deben compartir los contadores.
const buckets: Map<string, { count: number; resetAt: number }> = ((globalThis as unknown as { __pzRate?: Map<string, { count: number; resetAt: number }> }).__pzRate ??= new Map());
let lastSweep = 0;

/** `cost`: lo que suma esta llamada al contador (p. ej. las tareas de una creación múltiple). */
export function rateLimit(key: string, limit: number, windowMs: number, cost = 1): boolean {
  const now = Date.now();
  // Limpieza como mucho una vez por segundo (no en cada llamada) y tope duro ante claves masivas.
  if (buckets.size > 5000 && now - lastSweep > 1000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    // Tope duro: se descartan las claves más antiguas (no todas, que borraría también los intentos de login).
    if (buckets.size > 50_000) for (const k of [...buckets.keys()].slice(0, buckets.size - 40_000)) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: cost, resetAt: now + windowMs });
    return cost <= limit;
  }
  bucket.count += cost;
  return bucket.count <= limit;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Claves del límite de inicio de sesión: por IP (todas las peticiones) y por cuenta (solo los fallos, desde cualquier
 * conexión: frena a quien prueba contraseñas desde muchas; a cambio, un tercero puede bloquear la cuenta unos minutos).
 */
export function loginRateKeys(ip: string, email: string): { ip: string; account: string } {
  const e = email.trim().toLowerCase().slice(0, 200);
  return { ip: `login:ip:${ip}`, account: `login:acct:${e}` };
}

/** Fallos permitidos por cuenta en la ventana del login (cualquier conexión). */
export const LOGIN_ACCOUNT_LIMIT = 6;
/**
 * Desde un dispositivo recordado de esa cuenta se admiten fallos hasta este tope. Un tercero (sin el dispositivo) se
 * queda en LOGIN_ACCOUNT_LIMIT, así que no puede gastar estos intentos: quien entra desde su equipo no queda bloqueado.
 */
export const LOGIN_ACCOUNT_LIMIT_TRUSTED = 10;

/** ¿Ya se han gastado los `limit` usos de `key` en su ventana? Solo consulta: no cuenta este uso. */
export function rateLimitReached(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return !!b && b.resetAt >= Date.now() && b.count >= limit;
}

/** Segundos que faltan para que se reinicie el contador de `key` (para Retry-After); 1 como mínimo. */
export function rateLimitRetryAfterSec(key: string): number {
  const b = buckets.get(key);
  return b ? Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000)) : 1;
}
