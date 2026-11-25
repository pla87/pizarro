import "server-only";
import type { Locale, T } from "../i18n/core";
import { MessagingApiError, MessagingNetworkError, networkErrorCode, scrubSecrets, whatsappCodePayload, whatsappPayload, withRetries, type NoticeMessage, type WhatsappConfig } from "./messaging-core";
import { isShuttingDown, trackInFlight } from "./shutdown";

// WhatsApp Cloud API de Meta (https://developers.facebook.com/docs/whatsapp/cloud-api). Fuera de una conversación
// abierta por la persona, Meta solo deja enviar plantillas aprobadas: Pizarro usa dos (ver docs/guias/whatsapp.md), la
// de utilidad aviso_pizarro para los avisos y la de autenticación codigo_pizarro para el código de verificación, y Meta
// cobra por cada mensaje entregado.

/**
 * Idioma en que se escribe un WhatsApp: el inglés solo si la plantilla tiene su traducción configurada («Idioma en
 * inglés»). Sin ella se envía la plantilla en español, y sus variables deben ir también en español: antes salía el texto
 * en español con el aviso en inglés dentro.
 */
export function whatsappLocale(cfg: Pick<WhatsappConfig, "templateLangEn">, locale: Locale): Locale {
  return locale === "en" && cfg.templateLangEn ? "en" : "es";
}

/**
 * Envía un aviso con la plantilla configurada. Reintentos limitados y solo de lo que Meta no pudo cobrar: 429 y errores
 * de conexión antes de enviar; un 5xx, un ECONNRESET o un tiempo agotado no se repiten. El apagado espera al envío.
 */
export function sendWhatsappNotice(cfg: WhatsappConfig, to: string, m: NoticeMessage, t: T, english: boolean): Promise<void> {
  return trackInFlight(() => withRetries("WHATSAPP", () => post(cfg, whatsappPayload(to, m, cfg, t, english), to), { stopping: isShuttingDown }));
}

/**
 * Envía el código de verificación con la plantilla de autenticación (botón «Copiar código»). Mismos reintentos que un
 * aviso. `english`: la persona usa Pizarro en inglés (sale en inglés si la verificación tiene ese idioma configurado).
 */
export function sendWhatsappCode(cfg: WhatsappConfig, to: string, code: string, english = false): Promise<void> {
  return trackInFlight(() => withRetries("WHATSAPP", () => post(cfg, whatsappCodePayload(to, code, cfg, english), to), { stopping: isShuttingDown }));
}

/**
 * Último rechazo del token por Meta (401, 403 o el código 190: caducado, revocado o sin permiso), en memoria como el
 * estado de Telegram. Sin él, con un token temporal de 24 h, Integraciones seguía diciendo «Activo» y cada aviso fallaba
 * solo en Logs. Lo borra el siguiente envío que sale bien (un aviso, un código o «Probar») o guardar otro token.
 */
interface WhatsappAuthError { message: string; at: string }
const AUTH_GLOBAL = "__pizarroWhatsappAuth";
const authSlot = () => globalThis as unknown as Record<string, WhatsappAuthError | null | undefined>;
export function whatsappAuthError(): WhatsappAuthError | null {
  return authSlot()[AUTH_GLOBAL] ?? null;
}
export function clearWhatsappAuthError(): void {
  authSlot()[AUTH_GLOBAL] = null;
}
const isAuthFailure = (status: number, code: number | null | undefined) => status === 401 || status === 403 || code === 190;

async function post(cfg: WhatsappConfig, body: unknown, to: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Tiempo agotado: puede que Meta sí lo haya enviado (y cobrado); no se reintenta (ver classifyFailure).
    if ((err as Error)?.name === "TimeoutError") throw new MessagingApiError("WhatsApp: tiempo de espera agotado", 408);
    // Fallo de red: se conserva el código (ECONNREFUSED, ENOTFOUND…) para saber si la petición llegó a salir. Solo se
    // reintenta lo que seguro que no salió; un ECONNRESET puede llegar con el mensaje ya aceptado (classifyFailure).
    const code = networkErrorCode(err);
    const cause = (err as { cause?: { message?: string } })?.cause?.message;
    throw new MessagingNetworkError(scrubSecrets(`WhatsApp: ${(err as Error)?.message ?? String(err)}${cause ? ` (${cause})` : ""}`, [cfg.token, to, to.replace(/^\+/, "")]), code);
  }
  if (res.ok) {
    clearWhatsappAuthError();
    return;
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } };
  const detail = json.error?.error_data?.details;
  const message = `WhatsApp ${res.status}${json.error?.code ? ` (${json.error.code})` : ""}: ${json.error?.message ?? "error"}${detail ? ` — ${detail}` : ""}`;
  const retryAfter = Number(res.headers.get("retry-after"));
  const safe = scrubSecrets(message, [cfg.token, cfg.phoneNumberId, to, to.replace(/^\+/, "")]);
  if (isAuthFailure(res.status, json.error?.code)) authSlot()[AUTH_GLOBAL] = { message: safe, at: new Date().toISOString() };
  throw new MessagingApiError(safe, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null, json.error?.code ?? null);
}
