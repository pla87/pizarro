// Limitador en memoria (suficiente para un único contenedor).
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // Limpieza como mucho una vez por segundo (no en cada llamada) y tope duro ante claves masivas.
  if (buckets.size > 5000 && now - lastSweep > 1000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    if (buckets.size > 50_000) buckets.clear();
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Claves del límite de inicio de sesión: por pareja IP+email (estricto) y por IP (más holgado). */
export function loginRateKeys(ip: string, email: string): { pair: string; ip: string } {
  const e = email.trim().toLowerCase().slice(0, 200);
  return { pair: `login:pair:${ip}|${e}`, ip: `login:ip:${ip}` };
}
