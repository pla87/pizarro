// Limitador en memoria (suficiente para un único contenedor).
// En globalThis: acciones y rutas pueden empaquetarse por separado y deben compartir los contadores.
type Bucket = { count: number; resetAt: number };
type Store = { map: Map<string, Bucket>; lastSweep: number; sweepAt: number; max: number; keep: number };
const g = globalThis as unknown as { __pzRate?: Map<string, Bucket>; __pzRateStores?: { general: Store; security: Store } };
const stores = (g.__pzRateStores ??= {
  general: { map: (g.__pzRate ??= new Map()), lastSweep: 0, sweepAt: 5000, max: 50_000, keep: 40_000 },
  // Bloqueos de seguridad (intentos de acceso, recuperación, 2FA…): mapa aparte, para que inundar una ruta cualquiera
  // con claves nuevas (p. ej. /api/client-errors desde muchas IP) no vacíe el bloqueo de una cuenta. Tope propio y holgado.
  security: { map: new Map(), lastSweep: 0, sweepAt: 5000, max: 100_000, keep: 80_000 },
});

/**
 * Prefijos de las claves de bloqueo de seguridad (guardadas en su propio mapa). Las de una IP terminan en ella, así que
 * cualquier clave que empiece por uno de estos prefijos cuenta.
 */
const SECURITY_KEY_PREFIXES = ["login:", "reset:", "reset-submit:", "confirm:", "2fa:", "setup:", "glogin:", "password:", "email-change:", "force-password:"] as const;

const storeFor = (key: string): Store => (SECURITY_KEY_PREFIXES.some((p) => key.startsWith(p)) ? stores.security : stores.general);

/**
 * IP para las claves del limitador: una IPv6 se agrupa por su /64 (lo que suele tener una sola conexión o máquina, que
 * puede ir cambiando de dirección dentro de él sin salirse del límite); una IPv4, o IPv6 que la envuelve (::ffff:a.b.c.d),
 * queda tal cual. Lo que no parece una IP («unknown») se devuelve sin cambios.
 */
export function rateIp(ip: string): string {
  const raw = ip.trim();
  let a = raw.toLowerCase();
  if (a.startsWith("[") && a.includes("]")) a = a.slice(1, a.indexOf("]"));
  a = a.replace(/%.*$/, ""); // zona (fe80::1%eth0)
  if (!a.includes(":")) return raw;
  const halves = a.split("::");
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // Una IPv4 al final (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) ocupa los dos últimos grupos.
  const end = tail.length ? tail : head;
  const dotted = end.length ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(end[end.length - 1]!) : null;
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return raw;
    end.splice(-1, 1, ((o[0]! << 8) | o[1]!).toString(16), ((o[2]! << 8) | o[3]!).toString(16));
  }
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return raw;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((x) => x.replace(/^0+(?=.)/, ""));
  if (!groups.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return raw;
  const n = groups.map((x) => parseInt(x, 16));
  // IPv4 envuelta en IPv6 (::ffff:a.b.c.d): cuenta como esa IPv4.
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return `${n[6]! >> 8}.${n[6]! & 255}.${n[7]! >> 8}.${n[7]! & 255}`;
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** Limpieza como mucho una vez por segundo (no en cada llamada) y tope duro ante claves masivas. */
function sweep(store: Store, now: number) {
  if (store.map.size <= store.sweepAt || now - store.lastSweep <= 1000) return;
  store.lastSweep = now;
  for (const [k, b] of store.map) if (b.resetAt < now) store.map.delete(k);
  // Tope duro: se descartan las claves más antiguas (no todas). Los bloqueos de seguridad están en otro mapa.
  if (store.map.size > store.max) for (const k of [...store.map.keys()].slice(0, store.map.size - store.keep)) store.map.delete(k);
}

/** `cost`: lo que suma esta llamada al contador (p. ej. las tareas de una creación múltiple). */
export function rateLimit(key: string, limit: number, windowMs: number, cost = 1): boolean {
  const now = Date.now();
  const store = storeFor(key);
  sweep(store, now);
  const bucket = store.map.get(key);
  if (!bucket || bucket.resetAt < now) {
    store.map.set(key, { count: cost, resetAt: now + windowMs });
    return cost <= limit;
  }
  bucket.count += cost;
  return bucket.count <= limit;
}

export function resetRateLimit(key: string): void {
  storeFor(key).map.delete(key);
}

/**
 * Claves del límite de inicio de sesión: por IP (todas las peticiones) y por cuenta (solo los fallos, desde cualquier
 * conexión: frena a quien prueba contraseñas desde muchas; a cambio, un tercero puede bloquear la cuenta unos minutos).
 */
export function loginRateKeys(ip: string, email: string): { ip: string; account: string } {
  const e = email.trim().toLowerCase().slice(0, 200);
  return { ip: `login:ip:${rateIp(ip)}`, account: `login:acct:${e}` };
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
  const b = storeFor(key).map.get(key);
  return !!b && b.resetAt >= Date.now() && b.count >= limit;
}

/** Segundos que faltan para que se reinicie el contador de `key` (para Retry-After); 1 como mínimo. */
export function rateLimitRetryAfterSec(key: string): number {
  const b = storeFor(key).map.get(key);
  return b ? Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000)) : 1;
}
