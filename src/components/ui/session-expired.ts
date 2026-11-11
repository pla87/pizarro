// Error de las acciones sin sesión (requireUser, 401). El servidor ya no sabe quién eres y lo traduce al idioma de la
// instalación, que puede no ser el de tu interfaz: se reconoce en los dos idiomas y el aviso se pinta siempre con el de
// la interfaz (ver Toast). El inglés va escrito aquí para no cargar el diccionario en el JavaScript común; una prueba
// comprueba que coincide con su traducción.
export const SESSION_EXPIRED = "Sesión caducada. Vuelve a iniciar sesión.";
export const SESSION_EXPIRED_EN = "Session expired. Please sign in again.";

/** ¿Es el error de sesión caducada (en español, en inglés o en el idioma de la interfaz)? */
export function isSessionExpiredMessage(message: string, t: (s: string) => string): boolean {
  return message === SESSION_EXPIRED || message === SESSION_EXPIRED_EN || message === t(SESSION_EXPIRED);
}
