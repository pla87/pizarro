import { LEGACY_DEVICE_COOKIE, PASSWORD_CHANGE_COOKIE, cookieSecure, deviceCookieName, sessionCookieName } from "./session-config";

// Cookies de acceso de un navegador: sesión, cambio de contraseña pendiente, verificación en dos pasos (LoginChallenge)
// y dispositivos conocidos (con HTTPS, también la del nombre antiguo). El nombre de la de verificación está duplicado a
// propósito (two-factor.ts es «server-only» con base de datos); tests/db/client-errors.test.ts comprueba que coincide.
export const CHALLENGE_COOKIE_NAME = "pz_2fa";

/** Cabeceras Set-Cookie que borran todas las cookies de acceso (mismos atributos que al crearlas: un __Host- sin Secure se rechazaría). */
export function clearAuthCookieHeaders(): string[] {
  const secure = cookieSecure() ? "; Secure" : "";
  const devices = [...new Set([deviceCookieName(), LEGACY_DEVICE_COOKIE])];
  return [sessionCookieName(), PASSWORD_CHANGE_COOKIE, CHALLENGE_COOKIE_NAME, ...devices].map(
    (name) => `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
  );
}
