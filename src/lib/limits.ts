// Máximo de usuarios activos de la instalación: la variable MAX_USERS del servidor (por defecto, 10). Sin dependencias:
// se prueba en tests/limits.test.ts.

type Env = Record<string, string | undefined>;

/** Usuarios activos si MAX_USERS no está definida o no vale. */
export const DEFAULT_MAX_USERS = 10;
const MAX_MAX_USERS = 1_000_000;

/** De dónde sale el máximo: la variable, el valor por defecto (sin variable) o el defecto porque la variable no vale. */
export type MaxUsersSource = "env" | "default" | "invalid";

/**
 * MAX_USERS validado como DATABASE_POOL_SIZE (db-pool.ts): antes `Number("diez")` daba NaN (sin tope: `n >= NaN` nunca es
 * cierto) y `MAX_USERS=` (vacía) daba 0 (no se podía dar de alta a nadie). Un valor que no sea un entero entre 1 y un
 * millón no se usa: se usa 10 y se devuelve el aviso para el log.
 */
export function maxUsersConfig(env: Env = process.env): { max: number; source: MaxUsersSource; warning: string | null } {
  const raw = env.MAX_USERS?.trim();
  if (!raw) return { max: DEFAULT_MAX_USERS, source: "default", warning: null };
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isSafeInteger(n) && n >= 1 && n <= MAX_MAX_USERS) return { max: n, source: "env", warning: null };
  return {
    max: DEFAULT_MAX_USERS,
    source: "invalid",
    warning: `MAX_USERS no es un número entero entre 1 y ${MAX_MAX_USERS}; se usa ${DEFAULT_MAX_USERS}.`,
  };
}

const config = maxUsersConfig();
if (config.warning) console.warn(`[usuarios] ${config.warning}`);

/** Máximo de usuarios activos (se lee al arrancar: cambiar MAX_USERS pide reiniciar Pizarro). */
export const MAX_USERS = config.max;
/** De dónde sale MAX_USERS (para explicarlo en Administración → Usuarios y en el diagnóstico). */
export const MAX_USERS_SOURCE: MaxUsersSource = config.source;
