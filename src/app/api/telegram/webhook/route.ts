import { logEvent } from "@/lib/log";
import { loadMessagingConfig } from "@/lib/messaging-config";
import { safeEqual, scrubSecrets, telegramMode, TELEGRAM_WEBHOOK_MAX_BYTES } from "@/lib/messaging-core";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram";
import { BodyTooLargeError, declaredLength, readBodyLimited } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook del bot de Telegram (Administración → Ajustes → Telegram). Lo llama Telegram, no un navegador: no hay sesión
// ni Origin, y queda fuera del proxy de sesión (src/proxy.ts). La credencial es el secreto que Pizarro dio a Telegram
// al registrar el webhook (setWebhook secret_token), que llega en X-Telegram-Bot-Api-Secret-Token y se compara en
// tiempo constante. Responde 200 aunque falle el proceso de un mensaje: si no, Telegram lo reintentaría sin fin.

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`telegram:webhook:${ip}`, 120, 60_000)) return new Response(null, { status: 429 });
  const cfg = await loadMessagingConfig();
  if (!cfg.telegram.active || !cfg.telegram.webhookSecret || telegramMode(process.env.APP_URL).mode !== "webhook") return new Response(null, { status: 404 });
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", cfg.telegram.webhookSecret)) {
    // Quien no sabe el secreto no llega a leer el cuerpo; los fallos repetidos desde una IP se frenan.
    if (rateLimit(`telegram:webhook:bad:${ip}`, 1, 10 * 60_000)) logEvent({ level: "warn", category: "api", action: "telegram.webhookUnauthorized", message: "Llamada al webhook de Telegram con un secreto incorrecto", ip });
    return new Response(null, { status: 401 });
  }
  const declared = declaredLength(req.headers);
  if (declared !== null && declared > TELEGRAM_WEBHOOK_MAX_BYTES) return new Response(null, { status: 413 });
  let raw = "";
  try {
    raw = await readBodyLimited(req, TELEGRAM_WEBHOOK_MAX_BYTES, "text");
  } catch (err) {
    if (err instanceof BodyTooLargeError) return new Response(null, { status: 413 });
    return new Response(null, { status: 400 });
  }
  let update: TelegramUpdate | null = null;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {}
  if (!update || typeof update !== "object" || typeof update.update_id !== "number") return new Response(null, { status: 400 });
  try {
    await handleTelegramUpdate(update, cfg);
  } catch (err) {
    logEvent({ level: "error", category: "api", action: "telegram.webhookFailed", message: `Fallo al procesar un mensaje del bot de Telegram: ${scrubSecrets((err as Error)?.message ?? String(err), [cfg.telegram.token])}` });
  }
  return new Response(null, { status: 200 });
}
