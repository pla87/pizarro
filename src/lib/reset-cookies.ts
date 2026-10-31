import { PASSWORD_CHANGE_COOKIE, cookieSecure, sessionCookieName } from "./session-config";

// Cookies de acceso de un navegador: sesión, cambio de contraseña pendiente, verificación en dos pasos (LoginChallenge)
// y dispositivo conocido. Los nombres de las dos últimas están duplicados a propósito (two-factor.ts y devices.ts
// son «server-only» con base de datos); tests/reset-cookies.test.ts comprueba que siguen coincidiendo.
export const CHALLENGE_COOKIE_NAME = "pz_2fa";
export const DEVICE_COOKIE_NAME = "pz_device";

/** Cabeceras Set-Cookie que borran todas las cookies de acceso (mismos atributos que al crearlas: un __Host- sin Secure se rechazaría). */
export function clearAuthCookieHeaders(): string[] {
  const secure = cookieSecure() ? "; Secure" : "";
  return [sessionCookieName(), PASSWORD_CHANGE_COOKIE, CHALLENGE_COOKIE_NAME, DEVICE_COOKIE_NAME].map(
    (name) => `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
  );
}
