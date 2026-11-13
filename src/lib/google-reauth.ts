// «Volver a entrar con Google» para confirmar que se borra la cuenta (Mi perfil → Cuenta → Borrar mi cuenta), sin base
// de datos: la marca del flujo en la cookie de Google y adónde se vuelve. El resto, en las rutas de /api/auth/google y en
// two-factor.ts (confirmAccountDeleteWithGoogle).

/** Quinto campo de la cookie pz_glogin: esta vuelta de Google no abre sesión, confirma la baja. */
export const ACCOUNT_DELETE_PURPOSE = "account-delete";

/** Resultado de la vuelta, en `?delete=` de «Mi perfil → Cuenta». */
export type GoogleReauthResult = "google" | "google_mismatch" | "google_failed";

export function parseGoogleReauthResult(raw: string | undefined): GoogleReauthResult | null {
  return raw === "google" || raw === "google_mismatch" || raw === "google_failed" ? raw : null;
}

/** Ruta de vuelta a la sección «Borrar mi cuenta», con el resultado. */
export function accountDeleteReturn(result: GoogleReauthResult): string {
  return `/settings?tab=cuenta&delete=${result}#delete-account`;
}
