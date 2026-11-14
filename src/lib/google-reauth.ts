// «Volver a entrar con Google» para confirmar que se borra la cuenta (Mi perfil → Cuenta → Borrar mi cuenta), sin base
// de datos: la marca del flujo en la cookie de Google y adónde se vuelve. El resto, en las rutas de /api/auth/google y en
// two-factor.ts (confirmAccountDeleteWithGoogle).

/** Quinto campo de la cookie pz_glogin: esta vuelta de Google no abre sesión, confirma la baja. */
export const ACCOUNT_DELETE_PURPOSE = "account-delete";

/**
 * Resultado de la vuelta, en `?delete=` de «Mi perfil → Cuenta». `google_stale`: Google no ha vuelto a pedir la
 * contraseña (el id_token no trae `auth_time` o es de antes de empezar o de hace más de 5 minutos).
 */
export type GoogleReauthResult = "google" | "google_mismatch" | "google_failed" | "google_stale";

export function parseGoogleReauthResult(raw: string | undefined): GoogleReauthResult | null {
  return raw === "google" || raw === "google_mismatch" || raw === "google_failed" || raw === "google_stale" ? raw : null;
}

/** Antigüedad máxima de la contraseña escrita en Google para confirmar la baja. */
export const REAUTH_MAX_AGE_SECONDS = 5 * 60;
/** Margen por la diferencia de relojes entre Google y este servidor. */
const REAUTH_SKEW_SECONDS = 30;

/**
 * ¿La persona acaba de escribir su contraseña en Google? `authTime` (claim `auth_time` del id_token, en segundos) tiene
 * que existir, ser posterior al inicio del flujo (`startedAt`, segundos, de la cookie) y de hace como mucho 5 minutos.
 * Con `prompt=login` y `max_age=0` Google la pide siempre; si no lo ha hecho (o no dice cuándo), la vuelta no confirma
 * nada: elegir la cuenta en el selector de Google con su sesión abierta no basta para borrar la cuenta.
 */
export function reauthFreshness(authTime: number | null | undefined, startedAt: number, nowSec: number): "ok" | "missing" | "stale" {
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) return "missing";
  if (!Number.isFinite(startedAt) || authTime < startedAt - REAUTH_SKEW_SECONDS) return "stale";
  if (authTime > nowSec + REAUTH_SKEW_SECONDS || nowSec - authTime > REAUTH_MAX_AGE_SECONDS) return "stale";
  return "ok";
}

/** Ruta de vuelta a la sección «Borrar mi cuenta», con el resultado. */
export function accountDeleteReturn(result: GoogleReauthResult): string {
  return `/settings?tab=cuenta&delete=${result}#delete-account`;
}
