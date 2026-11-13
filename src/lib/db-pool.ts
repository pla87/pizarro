// Configuración del pool de PostgreSQL de la app (lib/db.ts), sin dependencias: se prueba en tests/db-pool.test.ts.

type Env = Record<string, string | undefined>;

/** Conexiones del pool si DATABASE_POOL_SIZE no está o no vale. */
export const DEFAULT_POOL_SIZE = 10;
const MAX_POOL_SIZE = 500;
/**
 * Tope para conseguir una conexión: abrirla (TCP, TLS y arranque de la sesión) o esperar a que quede una libre. Sin
 * él, pg esperaba para siempre: con la base caída o un cortafuegos que descarta los paquetes, cada petición se quedaba
 * colgada en vez de dar error.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const MIN_CONNECT_TIMEOUT_MS = 1000;
const MAX_CONNECT_TIMEOUT_MS = 300_000;

/** Entero en [min, max] o null (vacío, decimales, texto, fuera de rango). */
function intIn(raw: string | undefined, min: number, max: number): number | null {
  const s = raw?.trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/**
 * Tamaño del pool (DATABASE_POOL_SIZE) y tope de conexión (DATABASE_CONNECT_TIMEOUT_MS). Un valor que no sea un entero
 * razonable no se usa: antes `Number("diez")` daba NaN y pg lo tomaba como «sin límite de conexiones». Se devuelve el
 * aviso para el log de arranque.
 */
export function dbPoolConfig(env: Env = process.env): { max: number; connectionTimeoutMillis: number; warnings: string[] } {
  const warnings: string[] = [];
  let max = DEFAULT_POOL_SIZE;
  if (env.DATABASE_POOL_SIZE?.trim()) {
    const n = intIn(env.DATABASE_POOL_SIZE, 1, MAX_POOL_SIZE);
    if (n === null) warnings.push(`DATABASE_POOL_SIZE no es un número entero entre 1 y ${MAX_POOL_SIZE}; se usa ${DEFAULT_POOL_SIZE}.`);
    else max = n;
  }
  let connectionTimeoutMillis = DEFAULT_CONNECT_TIMEOUT_MS;
  if (env.DATABASE_CONNECT_TIMEOUT_MS?.trim()) {
    const n = intIn(env.DATABASE_CONNECT_TIMEOUT_MS, MIN_CONNECT_TIMEOUT_MS, MAX_CONNECT_TIMEOUT_MS);
    if (n === null) warnings.push(`DATABASE_CONNECT_TIMEOUT_MS no es un número entero de milisegundos entre ${MIN_CONNECT_TIMEOUT_MS} y ${MAX_CONNECT_TIMEOUT_MS}; se usa ${DEFAULT_CONNECT_TIMEOUT_MS}.`);
    else connectionTimeoutMillis = n;
  }
  return { max, connectionTimeoutMillis, warnings };
}

/** Servidor y base de DATABASE_URL para el log (sin usuario ni contraseña). */
export function dbTarget(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname && u.pathname !== "/" ? `, base ${decodeURIComponent(u.pathname.slice(1))}` : ""}`;
  } catch {
    return "DATABASE_URL no válida";
  }
}

/** Mensaje del log cuando no se consigue una conexión con PostgreSQL. */
export function dbConnectErrorMessage(err: unknown, url: string | undefined, timeoutMs: number): string {
  const e = err as { message?: string; code?: string } | null;
  const raw = e?.message ?? String(err);
  const why = /timeout/i.test(raw)
    ? `no ha respondido en ${Math.round(timeoutMs / 1000)} s (o todas las conexiones del pool siguen ocupadas)`
    : e?.code === "ECONNREFUSED"
      ? "ha rechazado la conexión (¿está en marcha?)"
      : e?.code === "ENOTFOUND" || e?.code === "EAI_AGAIN"
        ? "no se encuentra el servidor (revisa el nombre en DATABASE_URL)"
        : raw;
  return `[db] No se puede conectar con PostgreSQL (${dbTarget(url)}): ${why}. Comprueba DATABASE_URL y que la base de datos está en marcha.`;
}
