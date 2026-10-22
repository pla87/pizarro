// Configuración de la cookie de sesión. Sin dependencias de Node: la usa también proxy.ts.

const SESSION_MAX_AGE_DAYS = 30;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  if (process.env.APP_URL) return process.env.APP_URL.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

/** Con Secure se usa el prefijo __Host- (sin Domain, Path=/). */
export function sessionCookieName(): string {
  return cookieSecure() ? "__Host-tablon_session" : "tablon_session";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Marca (sin datos) de que la sesión de este navegador debe elegir una contraseña nueva. La usa proxy.ts para
 * cerrar el paso a todo lo demás sin consultar la BD; la comprobación real está en session.ts.
 */
export const PASSWORD_CHANGE_COOKIE = "pz_pwchange";
