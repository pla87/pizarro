// Tope opcional de usuarios activos de la instalación: la variable MAX_USERS del servidor. Sin ella no hay tope (la web
// promete «Un servidor, tantas personas como quieras»). Sin dependencias: se prueba en tests/limits.test.ts.

type Env = Record<string, string | undefined>;

const MAX_MAX_USERS = 1_000_000;

/** De dónde sale el tope: la variable, ninguno (sin variable) o ninguno porque la variable no vale. */
export type MaxUsersSource = "env" | "default" | "invalid";

/**
 * MAX_USERS validado como DATABASE_POOL_SIZE (db-pool.ts): `max` es el tope o null si no hay. Sin la variable (o vacía),
 * sin tope. Un valor que no sea un entero entre 1 y un millón no se aplica (antes `Number("diez")` daba NaN y
 * `MAX_USERS=` daba 0, que no dejaba dar de alta a nadie): sin tope, con el aviso para el log, el diagnóstico y
 * Administración → Usuarios.
 */
export function maxUsersConfig(env: Env = process.env): { max: number | null; source: MaxUsersSource; warning: string | null } {
  const raw = env.MAX_USERS?.trim();
  if (!raw) return { max: null, source: "default", warning: null };
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isSafeInteger(n) && n >= 1 && n <= MAX_MAX_USERS) return { max: n, source: "env", warning: null };
  return { max: null, source: "invalid", warning: `MAX_USERS no es un número entero entre 1 y ${MAX_MAX_USERS}; no se aplica ningún tope de usuarios.` };
}

const config = maxUsersConfig();
if (config.warning) console.warn(`[usuarios] ${config.warning}`);

/** Tope de usuarios activos, o null si no hay (se lee al arrancar: cambiar MAX_USERS pide reiniciar Pizarro). */
export const MAX_USERS = config.max;
/** De dónde sale MAX_USERS (para explicarlo en Administración → Usuarios y en el diagnóstico). */
export const MAX_USERS_SOURCE: MaxUsersSource = config.source;
