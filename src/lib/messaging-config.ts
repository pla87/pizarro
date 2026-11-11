import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./keyring";
import {
  last4, NO_TELEGRAM, parseTelegramSettings, parseWhatsappSettings, resolveTelegramConfig, resolveWhatsappConfig,
  TELEGRAM_BOT_ID_KEY, TELEGRAM_BOT_KEY, TELEGRAM_ENABLED_KEY, TELEGRAM_KEYS, TELEGRAM_LAST4_KEY, TELEGRAM_SECRET_KEY, TELEGRAM_TOKEN_KEY,
  WHATSAPP_ENABLED_KEY, WHATSAPP_KEYS, WHATSAPP_LANG_EN_KEY, WHATSAPP_LANG_KEY, WHATSAPP_LAST4_KEY, WHATSAPP_PHONE_ID_KEY, WHATSAPP_TEMPLATE_KEY, WHATSAPP_TOKEN_KEY,
  type TelegramConfig, type TelegramSettings, type WhatsappConfig, type WhatsappSettings, type WhatsappSettingsInput,
} from "./messaging-core";

// Configuración de Telegram y WhatsApp guardada en Administración → Ajustes (AppState, con los tokens cifrados con
// ENCRYPTION_KEY). Como el email (lib/mail-config.ts): copia en memoria de 30 s en globalThis, que se rehace al guardar.
// Las variables WHATSAPP_* del servidor rellenan lo que no se haya guardado (lib/messaging-core.ts, resolveWhatsappConfig).

const TTL_MS = 30_000;

export interface MessagingConfig {
  telegram: TelegramConfig;
  whatsapp: WhatsappConfig;
  telegramSettings: TelegramSettings;
  whatsappSettings: WhatsappSettings;
}

interface Store {
  config: MessagingConfig | null;
  at: number;
  loading: Promise<MessagingConfig> | null;
}

const GLOBAL = "__pizarroMessagingConfig";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[GLOBAL] ??= { config: null, at: 0, loading: null });
}

const ALL_KEYS = [...TELEGRAM_KEYS, ...WHATSAPP_KEYS];

/** Descifra un token guardado; si ninguna clave lo abre, se trata como ausente (y se avisa en el registro). */
function open(enc: string, what: string): string {
  if (!enc) return "";
  try {
    return decryptSecret(enc);
  } catch {
    console.error(`[messaging] No se pudo descifrar ${what} (¿cambió ENCRYPTION_KEY?). Vuelve a guardarlo en Administración → Ajustes.`);
    return "";
  }
}

async function read(): Promise<MessagingConfig> {
  const rows = await db.appState.findMany({ where: { key: { in: ALL_KEYS } }, select: { key: true, value: true } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const telegramSettings = parseTelegramSettings(rows);
  const whatsappSettings = parseWhatsappSettings(rows);
  return {
    telegramSettings,
    whatsappSettings,
    telegram: resolveTelegramConfig(telegramSettings, open(get(TELEGRAM_TOKEN_KEY), "el token de Telegram"), open(get(TELEGRAM_SECRET_KEY), "el secreto del webhook de Telegram")),
    whatsapp: resolveWhatsappConfig(process.env, whatsappSettings, open(get(WHATSAPP_TOKEN_KEY), "el token de WhatsApp")),
  };
}

const EMPTY = (): MessagingConfig => {
  const telegramSettings = parseTelegramSettings([]);
  const whatsappSettings = parseWhatsappSettings([]);
  return { telegramSettings, whatsappSettings, telegram: NO_TELEGRAM, whatsapp: resolveWhatsappConfig(process.env, whatsappSettings, "") };
};

/**
 * Configuración efectiva (con caché de 30 s; `fresh` lee la BD siempre). Si la BD falla, conserva la última conocida
 * (o solo las variables del servidor).
 */
export async function loadMessagingConfig(opts: { fresh?: boolean } = {}): Promise<MessagingConfig> {
  const s = store();
  if (!opts.fresh && s.config && Date.now() - s.at < TTL_MS) return s.config;
  return refreshMessagingConfig();
}

export function refreshMessagingConfig(): Promise<MessagingConfig> {
  const s = store();
  s.loading ??= (async () => {
    try {
      s.config = await read();
      s.at = Date.now();
      return s.config;
    } catch {
      s.config ??= EMPTY();
      s.at = Date.now() - TTL_MS + 5_000;
      return s.config;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

/** Tras guardar: se espera a una lectura en curso (con datos anteriores) y se vuelve a leer. */
export async function reloadMessagingConfig(): Promise<MessagingConfig> {
  const s = store();
  s.config = null;
  if (s.loading) await s.loading.catch(() => {});
  return refreshMessagingConfig();
}

async function upsert(entries: [string, string][], remove: string[] = []): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const [key, value] of entries) await tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
    if (remove.length) await tx.appState.deleteMany({ where: { key: { in: remove } } });
  });
}

/** Guarda el token del bot (ya comprobado con getMe) y su nombre. Crea el secreto del webhook si no lo hay. */
export async function saveTelegramToken(token: string, bot: { username: string; id: string }): Promise<void> {
  const cur = await loadMessagingConfig({ fresh: true });
  const entries: [string, string][] = [
    [TELEGRAM_TOKEN_KEY, encryptSecret(token)],
    [TELEGRAM_LAST4_KEY, last4(token)],
    [TELEGRAM_BOT_KEY, bot.username],
    [TELEGRAM_BOT_ID_KEY, bot.id],
  ];
  if (!cur.telegram.webhookSecret) entries.push([TELEGRAM_SECRET_KEY, encryptSecret(randomBytes(32).toString("base64url"))]);
  await upsert(entries);
  await reloadMessagingConfig();
}

export async function setTelegramEnabled(enabled: boolean): Promise<void> {
  await upsert([[TELEGRAM_ENABLED_KEY, String(enabled)]]);
  await reloadMessagingConfig();
}

/** Quita el token, el bot y el secreto del webhook (y lo desactiva). */
export async function clearTelegram(): Promise<void> {
  await upsert([[TELEGRAM_ENABLED_KEY, "false"]], [TELEGRAM_TOKEN_KEY, TELEGRAM_LAST4_KEY, TELEGRAM_BOT_KEY, TELEGRAM_BOT_ID_KEY, TELEGRAM_SECRET_KEY]);
  await reloadMessagingConfig();
}

/** Guarda los ajustes de WhatsApp. `token`: "" = conservar el guardado; `clearToken` lo borra (vuelve a usarse WHATSAPP_TOKEN si existe). */
export async function saveWhatsappSettings(input: WhatsappSettingsInput, opts: { token?: string; clearToken?: boolean; enabled?: boolean }): Promise<"set" | "cleared" | "unchanged"> {
  const entries: [string, string][] = [
    [WHATSAPP_PHONE_ID_KEY, input.phoneNumberId],
    [WHATSAPP_TEMPLATE_KEY, input.templateName],
    [WHATSAPP_LANG_KEY, input.templateLang],
    [WHATSAPP_LANG_EN_KEY, input.templateLangEn],
  ];
  if (opts.enabled !== undefined) entries.push([WHATSAPP_ENABLED_KEY, String(opts.enabled)]);
  const remove: string[] = [];
  let change: "set" | "cleared" | "unchanged" = "unchanged";
  if (opts.clearToken) {
    remove.push(WHATSAPP_TOKEN_KEY, WHATSAPP_LAST4_KEY);
    change = "cleared";
  } else if (opts.token) {
    entries.push([WHATSAPP_TOKEN_KEY, encryptSecret(opts.token)], [WHATSAPP_LAST4_KEY, last4(opts.token)]);
    change = "set";
  }
  await upsert(entries, remove);
  await reloadMessagingConfig();
  return change;
}

export async function setWhatsappEnabled(enabled: boolean): Promise<void> {
  await upsert([[WHATSAPP_ENABLED_KEY, String(enabled)]]);
  await reloadMessagingConfig();
}
