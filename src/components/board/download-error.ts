import { SESSION_EXPIRED } from "../ui/session-expired";

// Aparte de columnDownload.ts (que usa React) para probarlo sin navegador.

/**
 * Aviso de una descarga que el servidor ha rechazado (`status` y el cuerpo de la respuesta), para quien la ha pedido:
 * - 401 (la sesión ha caducado; el proxy responde `{"error":"No autorizado"}`): el aviso de sesión caducada, que el aviso
 *   convierte en el fijo con «Iniciar sesión» (ver Toast). Antes salía el JSON tal cual.
 * - 429 (el tope de PDF por minuto, column-route.ts): qué hacer, no «Demasiadas peticiones».
 * - Otro error con texto propio y corto: ese texto (el de `{"error": …}` si es JSON); si no, `failed`.
 */
export function downloadErrorText(status: number, body: string, failed: string, t: (s: string) => string): string {
  if (status === 401) return t(SESSION_EXPIRED);
  if (status === 429) return t("Has pedido muchos PDF seguidos: espera un minuto y vuelve a intentarlo.");
  const text = body.trim();
  if (text.startsWith("{")) {
    try {
      const error = (JSON.parse(text) as { error?: unknown }).error;
      return typeof error === "string" && error.trim() && error.length < 300 ? error.trim() : failed;
    } catch {
      return failed;
    }
  }
  // Una página de error (HTML) tampoco se enseña tal cual.
  return text && text.length < 300 && !text.startsWith("<") ? text : failed;
}
