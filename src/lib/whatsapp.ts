import "server-only";
import type { T } from "../i18n/core";
import { MessagingApiError, MessagingNetworkError, networkErrorCode, scrubSecrets, whatsappPayload, withRetries, type NoticeMessage, type WhatsappConfig } from "./messaging-core";
import { isShuttingDown, trackInFlight } from "./shutdown";

// WhatsApp Cloud API de Meta (https://developers.facebook.com/docs/whatsapp/cloud-api). Fuera de una conversación
// abierta por la persona, Meta solo deja enviar plantillas aprobadas: Pizarro usa una (aviso_pizarro, ver
// docs/guias/whatsapp.md) y Meta cobra por cada mensaje entregado.

/**
 * Envía un aviso con la plantilla configurada. Reintentos limitados y solo de lo que Meta no pudo cobrar: 429 y errores
 * de conexión antes de enviar; un 5xx, un ECONNRESET o un tiempo agotado no se repiten. El apagado espera al envío.
 */
export function sendWhatsappNotice(cfg: WhatsappConfig, to: string, m: NoticeMessage, t: T, english: boolean): Promise<void> {
  return trackInFlight(() => withRetries("WHATSAPP", () => post(cfg, whatsappPayload(to, m, cfg, t, english), to), { stopping: isShuttingDown }));
}

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
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } };
  const detail = json.error?.error_data?.details;
  const message = `WhatsApp ${res.status}${json.error?.code ? ` (${json.error.code})` : ""}: ${json.error?.message ?? "error"}${detail ? ` — ${detail}` : ""}`;
  const retryAfter = Number(res.headers.get("retry-after"));
  throw new MessagingApiError(scrubSecrets(message, [cfg.token, cfg.phoneNumberId, to, to.replace(/^\+/, "")]), res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null, json.error?.code ?? null);
}
