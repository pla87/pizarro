import "server-only";
import { randomBytes } from "node:crypto";
import { makeT, toLocale, type Locale } from "../i18n/core";
import { db } from "./db";
import { labelledHmac, labelledHmacCandidates } from "./keyring";
import { logEvent } from "./log";
import { loadMessagingConfig, type MessagingConfig } from "./messaging-config";
import {
  MessagingApiError, parseStartCode, scrubSecrets, telegramCommand, telegramMode, telegramSendBody, TELEGRAM_LINK_MINUTES, withRetries,
} from "./messaging-core";
import { rateLimit } from "./rate-limit";
import { isShuttingDown, trackInFlight } from "./shutdown";

// Bot de Telegram (Bot API, https://core.telegram.org/bots/api). Pizarro solo usa sendMessage para los avisos y recibe
// tres cosas del bot: «/start <código>» (enlaza el chat con la persona que pulsó «Conectar Telegram»), «/stop»
// (desconecta) y el aviso de que alguien ha bloqueado el bot (desconecta).
//
// Cómo llegan los mensajes del bot: con APP_URL https pública, por webhook (Telegram llama a /api/telegram/webhook con
// el secreto en X-Telegram-Bot-Api-Secret-Token). Si no (instalación en una red local, sin https), Pizarro pregunta a
// Telegram en segundo plano (getUpdates con espera larga): no hace falta abrir puertos. El sondeo es un solo bucle por
// proceso, se para al desactivar el bot o al apagar (las actualizaciones que no se confirmaron se vuelven a recibir).

const API = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "my_chat_member"];

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Llamada a la Bot API. Lanza MessagingApiError (sin el token) si Telegram responde con error. */
export async function telegramCall<T>(token: string, method: string, body: Record<string, unknown> = {}, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
  } catch (err) {
    // Los errores de red de fetch pueden llevar la URL (con el token): se limpian.
    throw new Error(scrubSecrets((err as Error)?.message ?? String(err), [token]));
  }
  const json = (await res.json().catch(() => ({}))) as TelegramResponse<T>;
  if (!res.ok || !json.ok) {
    throw new MessagingApiError(scrubSecrets(`Telegram ${json.error_code ?? res.status}: ${json.description ?? "error"}`, [token]), json.error_code ?? res.status, json.parameters?.retry_after ?? null);
  }
  return json.result as T;
}

export interface BotInfo {
  id: string;
  username: string;
  name: string;
}

/** Comprueba un token y devuelve el bot (getMe). */
export async function getBot(token: string): Promise<BotInfo> {
  const me = await telegramCall<{ id: number; username?: string; first_name?: string; is_bot?: boolean }>(token, "getMe", {}, { timeoutMs: 10_000 });
  if (!me?.is_bot || !me.username) throw new MessagingApiError("Telegram: el token no es de un bot", 400);
  return { id: String(me.id), username: me.username, name: me.first_name ?? me.username };
}

/** Envía un mensaje (HTML de Telegram) con reintentos limitados. El apagado ordenado espera a los envíos en curso. */
export function sendTelegramMessage(token: string, chatId: string, html: string): Promise<void> {
  return trackInFlight(() => withRetries("TELEGRAM", () => telegramCall(token, "sendMessage", telegramSendBody(chatId, html)), { stopping: isShuttingDown }).then(() => undefined));
}

// --- Estado del webhook o del sondeo (en memoria, para Administración) ---

interface PollState {
  running: boolean;
  gen: number;
  offset: number;
  abort: AbortController | null;
  /** Último resultado de registrar el webhook o de preguntar a Telegram. */
  lastError: string | null;
  lastOkAt: number;
  mode: "webhook" | "polling" | "off";
}

const GLOBAL = "__pizarroTelegram";
function poll(): PollState {
  const g = globalThis as unknown as Record<string, PollState | undefined>;
  return (g[GLOBAL] ??= { running: false, gen: 0, offset: 0, abort: null, lastError: null, lastOkAt: 0, mode: "off" });
}

export function telegramStatus(): { mode: PollState["mode"]; polling: boolean; lastError: string | null; lastOkAt: number } {
  const p = poll();
  return { mode: p.mode, polling: p.running, lastError: p.lastError, lastOkAt: p.lastOkAt };
}

function stopPolling(): void {
  const p = poll();
  p.gen++;
  p.abort?.abort();
  p.abort = null;
  p.running = false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function startPolling(): void {
  const p = poll();
  if (p.running) return;
  p.running = true;
  const gen = ++p.gen;
  void (async () => {
    let backoff = 0;
    while (gen === p.gen && !isShuttingDown()) {
      const cfg = await loadMessagingConfig().catch(() => null);
      if (!cfg?.telegram.active || telegramMode(process.env.APP_URL).mode !== "polling") break;
      try {
        p.abort = new AbortController();
        const updates = await telegramCall<TelegramUpdate[]>(cfg.telegram.token, "getUpdates", { offset: p.offset || undefined, timeout: 25, allowed_updates: ALLOWED_UPDATES }, { timeoutMs: 40_000, signal: p.abort.signal });
        backoff = 0;
        p.lastError = null;
        p.lastOkAt = Date.now();
        for (const u of updates) {
          // Se confirma aunque falle: una actualización que siempre falla no debe repetirse para siempre.
          p.offset = Math.max(p.offset, u.update_id + 1);
          if (gen !== p.gen) break;
          await trackInFlight(() => handleTelegramUpdate(u, cfg)).catch((err) => console.error("[telegram] actualización", scrubSecrets(String(err), [cfg.telegram.token])));
        }
      } catch (err) {
        if (gen !== p.gen || isShuttingDown()) break;
        p.lastError = scrubSecrets((err as Error).message, [cfg.telegram.token]);
        // 409: otro proceso pregunta con el mismo bot (o hay un webhook puesto): se espera más.
        backoff = err instanceof MessagingApiError && err.status === 409 ? 30_000 : Math.min(60_000, backoff ? backoff * 2 : 2_000);
        await sleep(backoff);
      }
    }
    if (gen === p.gen) p.running = false;
  })();
}

/**
 * Pone el bot como diga la configuración: webhook (APP_URL https pública), sondeo en segundo plano o nada (desactivado).
 * Se llama al arrancar y al guardar. Devuelve el error de Telegram, si lo hubo (sin el token).
 */
export async function syncTelegram(): Promise<{ mode: PollState["mode"]; error: string | null }> {
  const p = poll();
  const cfg = await loadMessagingConfig({ fresh: true });
  const { token } = cfg.telegram;
  if (!cfg.telegram.active) {
    stopPolling();
    p.mode = "off";
    p.lastError = null;
    // Sin webhook: Telegram deja de llamar a Pizarro (si el token sigue guardado).
    if (token) await telegramCall(token, "deleteWebhook", {}, { timeoutMs: 10_000 }).catch(() => {});
    return { mode: "off", error: null };
  }
  const m = telegramMode(process.env.APP_URL);
  try {
    if (m.mode === "webhook") {
      stopPolling();
      p.mode = "webhook";
      await telegramCall(token, "setWebhook", { url: m.webhookUrl, secret_token: cfg.telegram.webhookSecret, allowed_updates: ALLOWED_UPDATES, max_connections: 10 }, { timeoutMs: 15_000 });
      infoCache.at = 0;
    } else {
      p.mode = "polling";
      // Con un webhook puesto, getUpdates no funciona.
      await telegramCall(token, "deleteWebhook", {}, { timeoutMs: 10_000 });
      startPolling();
    }
    p.lastError = null;
    p.lastOkAt = Date.now();
    return { mode: p.mode, error: null };
  } catch (err) {
    p.lastError = scrubSecrets((err as Error).message, [token]);
    logEvent({ level: "error", category: "system", action: "telegram.syncFailed", message: `No se pudo preparar el bot de Telegram (${m.mode}): ${p.lastError}` });
    return { mode: p.mode, error: p.lastError };
  }
}

type WebhookInfo = { url: string; pending: number; lastError: string | null };
const INFO_TTL_MS = 30_000;
const infoCache = ((globalThis as unknown as { __pizarroTelegramInfo?: { at: number; key: string; value: WebhookInfo | null } }).__pizarroTelegramInfo ??= { at: 0, key: "", value: null });

/**
 * Qué dice Telegram del webhook (último error al llamar a Pizarro, pendientes). Null si no se puede saber. Se guarda
 * 30 s: la pantalla de Ajustes se vuelve a pintar tras cada cambio y no hace falta preguntar cada vez.
 */
export async function webhookInfo(token: string): Promise<WebhookInfo | null> {
  const key = labelledHmac("telegram-info", token);
  if (infoCache.key === key && Date.now() - infoCache.at < INFO_TTL_MS) return infoCache.value;
  let value: WebhookInfo | null = null;
  try {
    const info = await telegramCall<{ url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number }>(token, "getWebhookInfo", {}, { timeoutMs: 5_000 });
    const recent = info.last_error_date && Date.now() / 1000 - info.last_error_date < 24 * 3600;
    value = { url: info.url ?? "", pending: info.pending_update_count ?? 0, lastError: recent ? scrubSecrets(info.last_error_message ?? "", [token]) : null };
  } catch {
    value = null;
  }
  Object.assign(infoCache, { at: Date.now(), key, value });
  return value;
}

// --- Enlace de cuentas ---

const linkHash = (code: string) => labelledHmac("telegram-link", code);

/** Código de un solo uso para t.me/<bot>?start=<código>: caduca en TELEGRAM_LINK_MINUTES y anula los anteriores de la persona. */
export async function createTelegramLinkCode(userId: string, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000);
  await db.$transaction([
    db.telegramLinkCode.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: now } }] } }),
    db.telegramLinkCode.create({ data: { hash: linkHash(code), userId, expiresAt } }),
  ]);
  return { code, expiresAt };
}

/** Gasta un código: devuelve la persona (activa) a la que pertenece, o null si no existe, caducó o ya se usó. */
export async function consumeTelegramLinkCode(code: string, now = new Date()): Promise<{ id: string; name: string; locale: string } | null> {
  const row = await db.telegramLinkCode.findFirst({ where: { hash: { in: labelledHmacCandidates("telegram-link", code) }, expiresAt: { gt: now } }, select: { hash: true, userId: true } });
  if (!row) return null;
  // Solo quien lo borra lo gasta: dos /start con el mismo código a la vez no enlazan dos veces.
  const { count } = await db.telegramLinkCode.deleteMany({ where: { hash: row.hash } });
  if (count !== 1) return null;
  const user = await db.user.findFirst({ where: { id: row.userId, active: true }, select: { id: true, name: true, locale: true } });
  return user;
}

// --- Mensajes que llegan del bot ---

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number | string; type?: string }; from?: { username?: string; first_name?: string; language_code?: string } };
  my_chat_member?: { chat?: { id?: number | string; type?: string }; new_chat_member?: { status?: string } };
}

const tFor = (locale: Locale) => makeT(locale);
const langOf = (code: string | undefined): Locale => (code?.toLowerCase().startsWith("es") ? "es" : code ? "en" : "es");

async function reply(token: string, chatId: string, text: string): Promise<void> {
  // Tope por chat: el bot nunca entra en una conversación sin fin con nadie.
  if (!rateLimit(`telegram:reply:${chatId}`, 10, 10 * 60_000)) return;
  await sendTelegramMessage(token, chatId, text).catch((err) => console.error("[telegram] respuesta", scrubSecrets(String(err), [token])));
}

/** Desconecta todos los perfiles enlazados a este chat (bot bloqueado, /stop, chat borrado). */
export async function disconnectTelegramChat(chatId: string, reason: "stop" | "blocked" | "send-failed"): Promise<number> {
  const rows = await db.userChannel.findMany({ where: { channel: "TELEGRAM", address: chatId }, select: { id: true, userId: true, user: { select: { name: true } } } });
  if (!rows.length) return 0;
  await db.userChannel.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  const why = reason === "stop" ? "escribió /stop" : reason === "blocked" ? "bloqueó el bot" : "Telegram rechazó el envío (bot bloqueado o chat borrado)";
  for (const r of rows) logEvent({ level: reason === "stop" ? "info" : "warn", category: "notify", action: "notify.telegramDisconnected", message: `Telegram desconectado para ${r.user.name}: ${why}`, userId: r.userId, userName: r.user.name, details: { reason } });
  return rows.length;
}

/** Procesa una actualización del bot (llega por el webhook o por el sondeo). Solo chats privados. */
export async function handleTelegramUpdate(u: TelegramUpdate, cfg?: MessagingConfig): Promise<void> {
  const config = cfg ?? (await loadMessagingConfig());
  const { token } = config.telegram;
  if (!config.telegram.active) return;
  const member = u.my_chat_member;
  if (member?.chat?.type === "private" && member.chat.id !== undefined && (member.new_chat_member?.status === "kicked" || member.new_chat_member?.status === "left")) {
    await disconnectTelegramChat(String(member.chat.id), "blocked");
    return;
  }
  const msg = u.message;
  if (!msg || msg.chat?.type !== "private" || msg.chat.id === undefined || typeof msg.text !== "string") return;
  const chatId = String(msg.chat.id);
  const t = tFor(langOf(msg.from?.language_code));
  const cmd = telegramCommand(msg.text);
  if (cmd === "start") {
    const code = parseStartCode(msg.text);
    if (!code) return reply(token, chatId, t("Hola. Soy el bot de avisos de Pizarro. Para recibir aquí tus avisos, pulsa «Conectar Telegram» en Mi perfil → Avisos de Pizarro."));
    if (!rateLimit(`telegram:link:${chatId}`, 10, 10 * 60_000)) return;
    const user = await consumeTelegramLinkCode(code);
    if (!user) return reply(token, chatId, t("Este enlace ha caducado o ya se ha usado. Vuelve a pulsar «Conectar Telegram» en Mi perfil → Avisos de Pizarro."));
    const label = (msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "")).slice(0, 64);
    const now = new Date();
    await db.userChannel.upsert({
      where: { userId_channel: { userId: user.id, channel: "TELEGRAM" } },
      create: { userId: user.id, channel: "TELEGRAM", address: chatId, label, verifiedAt: now, consentAt: now },
      update: { address: chatId, label, verifiedAt: now, consentAt: now },
    });
    logEvent({ category: "notify", action: "notify.telegramLinked", message: `Telegram conectado para ${user.name}`, userId: user.id, userName: user.name });
    const ut = tFor(toLocale(user.locale));
    return reply(token, chatId, ut("Listo, {name}: a partir de ahora recibirás aquí tus avisos de Pizarro. Para dejar de recibirlos, escribe /stop o desconéctalo en Mi perfil → Avisos.", { name: user.name }));
  }
  if (cmd === "stop") {
    const n = await disconnectTelegramChat(chatId, "stop");
    return reply(token, chatId, n ? t("Hecho: ya no recibirás avisos de Pizarro aquí. Puedes volver a conectarte desde Mi perfil → Avisos.") : t("Este chat no está conectado a ninguna cuenta de Pizarro."));
  }
  return reply(token, chatId, t("Soy el bot de avisos de Pizarro: no leo mensajes. Para conectar o desconectar los avisos, ve a Mi perfil → Avisos de Pizarro (o escribe /stop)."));
}
