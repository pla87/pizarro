import { createHash, timingSafeEqual } from "node:crypto";
import type { T } from "../i18n/shared";
import { isProjectNotice, notificationBody, notificationHeadline, type NotificationKind } from "./notification-text";
import { codeTemplateProblem, type CodeTemplateProblem } from "./whatsapp-code-text";

// Parte pura (sin base de datos ni «server-only») de los avisos por Telegram y WhatsApp: claves de AppState, reglas de
// precedencia, validación, textos y cuerpos de las peticiones, y clasificación de los errores de las API.
// La usan el servidor, el diagnóstico, el script de rotación de claves y las pruebas.

// --- Claves de AppState ---

/** Token del bot de Telegram, cifrado con ENCRYPTION_KEY (lib/keyring.ts); nunca viaja al navegador. */
export const TELEGRAM_TOKEN_KEY = "telegram.tokenEnc";
/** Secreto que Telegram manda en X-Telegram-Bot-Api-Secret-Token con cada llamada al webhook (cifrado). */
export const TELEGRAM_SECRET_KEY = "telegram.webhookSecretEnc";
export const TELEGRAM_ENABLED_KEY = "telegram.enabled";
/** Nombre de usuario del bot (sin @) y su id numérico, de getMe: para el enlace t.me y para saber si cambió de bot. */
export const TELEGRAM_BOT_KEY = "telegram.botUsername";
export const TELEGRAM_BOT_ID_KEY = "telegram.botId";
/** Los 4 últimos caracteres del token: lo único que se muestra de él. */
export const TELEGRAM_LAST4_KEY = "telegram.tokenLast4";
export const TELEGRAM_KEYS = [TELEGRAM_TOKEN_KEY, TELEGRAM_SECRET_KEY, TELEGRAM_ENABLED_KEY, TELEGRAM_BOT_KEY, TELEGRAM_BOT_ID_KEY, TELEGRAM_LAST4_KEY] as const;

/** Token de acceso de la Cloud API de Meta, cifrado. */
export const WHATSAPP_TOKEN_KEY = "whatsapp.tokenEnc";
export const WHATSAPP_LAST4_KEY = "whatsapp.tokenLast4";
export const WHATSAPP_PHONE_ID_KEY = "whatsapp.phoneNumberId";
export const WHATSAPP_TEMPLATE_KEY = "whatsapp.templateName";
export const WHATSAPP_LANG_KEY = "whatsapp.templateLang";
/** Idioma de la plantilla para quien usa Pizarro en inglés (vacío = el mismo que el principal). */
export const WHATSAPP_LANG_EN_KEY = "whatsapp.templateLangEn";
/** «true»/«false»; sin guardar = activo si la configuración está completa (compatibilidad con las variables WHATSAPP_*). */
export const WHATSAPP_ENABLED_KEY = "whatsapp.enabled";
/** Plantilla de AUTENTICACIÓN con la que sale el código de verificación (vacío = codigo_pizarro) y su idioma (vacío = el de los avisos). */
export const WHATSAPP_CODE_TEMPLATE_KEY = "whatsapp.codeTemplateName";
export const WHATSAPP_CODE_LANG_KEY = "whatsapp.codeTemplateLang";
/**
 * Idioma de la plantilla de verificación para quien usa Pizarro en inglés (vacío = el mismo que para el resto). Aparte de
 * «Idioma en inglés» de los avisos: codigo_pizarro puede no tener la traducción aunque aviso_pizarro sí, y Meta rechaza
 * un idioma que la plantilla no tiene (y entonces el código no saldría para nadie hasta revisarlo).
 */
export const WHATSAPP_CODE_LANG_EN_KEY = "whatsapp.codeTemplateLangEn";
/** Último rechazo de Meta a la plantilla de verificación (JSON: código de error, plantilla, idioma y fecha); se borra al enviar bien un código o al guardar. */
export const WHATSAPP_CODE_ERROR_KEY = "whatsapp.codeTemplateError";
export const WHATSAPP_KEYS = [
  WHATSAPP_TOKEN_KEY, WHATSAPP_LAST4_KEY, WHATSAPP_PHONE_ID_KEY, WHATSAPP_TEMPLATE_KEY, WHATSAPP_LANG_KEY, WHATSAPP_LANG_EN_KEY, WHATSAPP_ENABLED_KEY,
  WHATSAPP_CODE_TEMPLATE_KEY, WHATSAPP_CODE_LANG_KEY, WHATSAPP_CODE_LANG_EN_KEY, WHATSAPP_CODE_ERROR_KEY,
] as const;

/** Plantilla que espera Pizarro (3 variables: aviso, proyecto y enlace). Ver docs/guias/whatsapp.md. */
export const DEFAULT_WHATSAPP_TEMPLATE = "aviso_pizarro";
/**
 * Plantilla de categoría Autenticación para el código de 6 cifras de Mi perfil. Meta solo admite códigos de un solo uso
 * en plantillas de autenticación (las de utilidad se pueden reclasificar o pausar): su texto lo fija Meta («Tu código de
 * verificación es *{{1}}*.») y lleva el botón «Copiar código».
 */
export const DEFAULT_WHATSAPP_CODE_TEMPLATE = "codigo_pizarro";
/** Plantilla de versiones anteriores (4 variables y solo menciones): se sigue admitiendo tal cual. */
export const LEGACY_WHATSAPP_TEMPLATE = "mencion_pizarro";
export const DEFAULT_WHATSAPP_API_VERSION = "v23.0";

type Env = Record<string, string | undefined>;
type Rows = { key: string; value: string }[];
const clean = (v: string | undefined) => (v ?? "").trim();
const getter = (rows: Rows) => (k: string) => rows.find((r) => r.key === k)?.value ?? "";

// --- Telegram ---

export interface TelegramSettings {
  hasToken: boolean;
  tokenLast4: string;
  enabled: boolean;
  botUsername: string;
  botId: string;
}

export function parseTelegramSettings(rows: Rows): TelegramSettings {
  const get = getter(rows);
  return {
    hasToken: get(TELEGRAM_TOKEN_KEY) !== "",
    tokenLast4: get(TELEGRAM_LAST4_KEY),
    enabled: get(TELEGRAM_ENABLED_KEY) === "true",
    botUsername: get(TELEGRAM_BOT_KEY).trim(),
    botId: get(TELEGRAM_BOT_ID_KEY).trim(),
  };
}

export interface TelegramConfig {
  /** Hay token, está activado y se sabe el nombre del bot (para el enlace t.me). */
  active: boolean;
  token: string;
  botUsername: string;
  webhookSecret: string;
}

export const NO_TELEGRAM: TelegramConfig = { active: false, token: "", botUsername: "", webhookSecret: "" };

export function resolveTelegramConfig(saved: TelegramSettings, token: string, webhookSecret: string): TelegramConfig {
  if (!token) return NO_TELEGRAM;
  return { active: saved.enabled && Boolean(saved.botUsername), token, botUsername: saved.botUsername, webhookSecret };
}

/** Formato del token que da @BotFather: «123456789:AA…». */
export const TELEGRAM_TOKEN_RE = /^\d{4,20}:[A-Za-z0-9_-]{30,60}$/;

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[.*\])$/i;
/** Puertos que Telegram admite para un webhook. */
const WEBHOOK_PORTS = new Set(["", "443", "80", "88", "8443"]);

/**
 * Cómo recibe Pizarro los mensajes del bot. «webhook»: Telegram llama a APP_URL/api/telegram/webhook (hace falta una
 * dirección https pública en un puerto que Telegram admita). «polling»: Pizarro pregunta a Telegram (getUpdates) en
 * segundo plano; funciona en una red local sin dirección pública.
 */
export function telegramMode(appUrl: string | undefined): { mode: "webhook" | "polling"; webhookUrl: string | null; reason: "ok" | "no-app-url" | "not-https" | "private-host" | "port" } {
  let url: URL;
  try {
    url = new URL(clean(appUrl));
  } catch {
    return { mode: "polling", webhookUrl: null, reason: "no-app-url" };
  }
  if (url.protocol !== "https:") return { mode: "polling", webhookUrl: null, reason: "not-https" };
  if (PRIVATE_HOST.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || !url.hostname.includes(".")) return { mode: "polling", webhookUrl: null, reason: "private-host" };
  if (!WEBHOOK_PORTS.has(url.port)) return { mode: "polling", webhookUrl: null, reason: "port" };
  const base = url.toString().replace(/\/$/, "");
  return { mode: "webhook", webhookUrl: `${base}/api/telegram/webhook`, reason: "ok" };
}

/** «/start <código>» (también «/start@mibot <código>»). Devuelve el código o null. */
export function parseStartCode(text: string | undefined): string | null {
  const m = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{16,64})\s*$/.exec(text ?? "");
  return m ? m[1]! : null;
}

export function telegramCommand(text: string | undefined): "start" | "stop" | "help" | null {
  const m = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.exec((text ?? "").trim());
  if (!m) return null;
  const cmd = m[1]!.toLowerCase();
  return cmd === "start" || cmd === "stop" || cmd === "help" ? cmd : null;
}

/** Enlace que abre el bot con el código: https://t.me/<bot>?start=<código>. */
export const telegramStartUrl = (bot: string, code: string) => `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(code)}`;

/** Compara dos secretos en tiempo constante (también si tienen longitudes distintas). */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export const escapeTelegramHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Texto preparado para Telegram con parse_mode HTML. Solo sale de `telegramHtml` (escapa todo lo interpolado), de
 * `telegramPlain` (escapa el texto entero) o de `joinTelegramHtml`: sendTelegramMessage no admite un string cualquiera,
 * así que un nombre con «&» o «<» no rompe el mensaje (400 de Telegram) ni cuela etiquetas o enlaces.
 */
export type TelegramHtml = string & { readonly __telegramHtml: true };

/** Plantilla con el HTML fijo del código; cada valor interpolado se escapa siempre. */
export function telegramHtml(strings: TemplateStringsArray, ...values: (string | number)[]): TelegramHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += escapeTelegramHtml(String(v)) + (strings[i + 1] ?? "");
  });
  return out as TelegramHtml;
}

/** Texto sin formato (respuestas del bot, con nombres interpolados por t()): se escapa entero. */
export const telegramPlain = (text: string): TelegramHtml => escapeTelegramHtml(text) as TelegramHtml;

/** Une trozos ya preparados (el separador es fijo). */
export const joinTelegramHtml = (parts: TelegramHtml[], sep: "\n" | " " = "\n"): TelegramHtml => parts.join(sep) as TelegramHtml;

/** Lo que hace falta para escribir un aviso (mismo contenido que el email). */
export interface NoticeMessage {
  type?: NotificationKind;
  actorName: string;
  taskTitle: string;
  projectName: string;
  excerpt: string;
  url: string;
  /** Idioma de Intl para formatear fechas (cambio de fecha límite). */
  locale?: string;
  /** Frase ya escrita en lugar de la del tipo de aviso (mensajes de prueba). */
  headline?: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Frase del aviso con la tarea entre comillas del idioma (como en el email), en una línea («Ana te ha asignado «Pantalla»»). */
export function noticeHeadline(m: NoticeMessage, t: T): string {
  if (m.headline) return oneLine(m.headline);
  return oneLine(notificationHeadline(m.type ?? "MENTION", t, { actor: m.actorName, task: t("«{title}»", { title: clip(oneLine(m.taskTitle), 120) }) }));
}

/**
 * Texto bajo la cabecera del aviso (el extracto: comentario, cambio de fecha…). En una asignación el extracto es el
 * título de la tarea, que ya va en la cabecera: si coincide (o es su principio recortado), no se repite. Si la tarea
 * cambió de título desde el aviso, el extracto (el título de entonces) sí se muestra.
 */
export function noticeBody(m: NoticeMessage, t: T): string {
  const body = notificationBody(m.type ?? "MENTION", m.excerpt, t, m.locale ?? "es-ES");
  if ((m.type ?? "MENTION") === "ASSIGNED") {
    const [b, title] = [oneLine(body), oneLine(m.taskTitle)];
    if (b === title || (b.endsWith("…") && title.startsWith(b.slice(0, -1)))) return "";
  }
  return body;
}

/** Texto del enlace del aviso: a la tarea o, en un aviso de proyecto, al proyecto. */
export const noticeLinkLabel = (m: Pick<NoticeMessage, "type">, t: T): string => (m.type && isProjectNotice(m.type) ? t("Abrir el proyecto") : t("Abrir la tarea"));

/** Mensaje de Telegram (HTML de Telegram, todo el contenido escapado): cabecera, proyecto, extracto y enlace. */
export function telegramNoticeText(m: NoticeMessage, t: T): TelegramHtml {
  const body = oneLine(noticeBody(m, t));
  const lines = [telegramHtml`<b>${noticeHeadline(m, t)}</b>`, telegramPlain(clip(oneLine(m.projectName), 100))];
  if (body) lines.push(telegramHtml`<i>${clip(body, 300)}</i>`);
  lines.push(telegramPlain(""), telegramHtml`<a href="${m.url}">${noticeLinkLabel(m, t)}</a>`);
  return joinTelegramHtml(lines);
}

/** Mensaje de prueba de Telegram (Ajustes y Mi perfil). */
export const telegramTestText = (t: T): TelegramHtml => telegramHtml`<b>${t("Mensaje de prueba de Pizarro")}</b>\n${t("Si lo lees, los avisos por Telegram funcionan.")}`;

export function telegramSendBody(chatId: string, text: TelegramHtml) {
  return { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
}

// --- WhatsApp ---

export interface WhatsappSettings {
  hasToken: boolean;
  tokenLast4: string;
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
  templateLangEn: string;
  /** Plantilla de verificación y su idioma tal como se guardaron (vacío = valor por defecto). */
  codeTemplateName: string;
  codeTemplateLang: string;
  codeTemplateLangEn: string;
  /** Último rechazo de Meta a la plantilla de verificación, o null. */
  codeTemplateError: CodeTemplateError | null;
  /** null = no se ha guardado: activo si la configuración está completa. */
  enabled: boolean | null;
}

/** Meta rechazó la plantilla de verificación: código de error de Meta, plantilla e idioma usados y cuándo (ISO). */
export interface CodeTemplateError {
  code: number;
  name: string;
  lang: string;
  at: string;
}

function parseCodeTemplateError(raw: string): CodeTemplateError | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CodeTemplateError>;
    if (typeof v.code !== "number" || typeof v.name !== "string" || typeof v.lang !== "string" || typeof v.at !== "string") return null;
    return { code: v.code, name: v.name, lang: v.lang, at: v.at };
  } catch {
    return null;
  }
}

export function parseWhatsappSettings(rows: Rows): WhatsappSettings {
  const get = getter(rows);
  const enabled = get(WHATSAPP_ENABLED_KEY);
  return {
    hasToken: get(WHATSAPP_TOKEN_KEY) !== "",
    tokenLast4: get(WHATSAPP_LAST4_KEY),
    phoneNumberId: get(WHATSAPP_PHONE_ID_KEY).trim(),
    templateName: get(WHATSAPP_TEMPLATE_KEY).trim(),
    templateLang: get(WHATSAPP_LANG_KEY).trim(),
    templateLangEn: get(WHATSAPP_LANG_EN_KEY).trim(),
    codeTemplateName: get(WHATSAPP_CODE_TEMPLATE_KEY).trim(),
    codeTemplateLang: get(WHATSAPP_CODE_LANG_KEY).trim(),
    codeTemplateLangEn: get(WHATSAPP_CODE_LANG_EN_KEY).trim(),
    codeTemplateError: parseCodeTemplateError(get(WHATSAPP_CODE_ERROR_KEY)),
    enabled: enabled === "" ? null : enabled === "true",
  };
}

export type Source = "db" | "env" | "default" | "none";

export interface WhatsappConfig {
  /** Configuración completa y activada. */
  active: boolean;
  /** Configuración completa (token, número y plantilla), esté activada o no. */
  complete: boolean;
  enabled: boolean;
  token: string;
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
  templateLangEn: string;
  /** Plantilla de autenticación del código de verificación (por defecto codigo_pizarro) y su idioma (por defecto, el de los avisos). */
  codeTemplateName: string;
  codeTemplateLang: string;
  /** Idioma de la verificación para quien usa Pizarro en inglés; vacío = el de codeTemplateLang para todos. */
  codeTemplateLangEn: string;
  apiVersion: string;
  /**
   * Formato antiguo (4 variables y solo menciones): la plantilla «mencion_pizarro» o cualquiera que venga solo de la
   * variable WHATSAPP_TEMPLATE_NAME (instalaciones anteriores a la configuración en Ajustes).
   */
  legacy: boolean;
  sources: { token: Source; phoneNumberId: Source; templateName: Source; templateLang: Source };
}

/**
 * Precedencia: lo guardado en Administración → Ajustes manda, campo a campo; lo que no se haya guardado sale de las
 * variables WHATSAPP_* del servidor (así una instalación que ya las usaba sigue funcionando sin tocar nada). Sin
 * activar ni desactivar nunca en la pantalla, está activo si la configuración está completa.
 */
export function resolveWhatsappConfig(env: Env, saved: WhatsappSettings, savedToken: string): WhatsappConfig {
  const pick = (db: string, envValue: string | undefined, fallback = ""): [string, Source] =>
    db ? [db, "db"] : clean(envValue) ? [clean(envValue), "env"] : fallback ? [fallback, "default"] : ["", "none"];
  const [token, tokenSrc] = pick(savedToken, env.WHATSAPP_TOKEN);
  const [phoneNumberId, phoneSrc] = pick(saved.phoneNumberId, env.WHATSAPP_PHONE_NUMBER_ID);
  const [templateName, templateSrc] = pick(saved.templateName, env.WHATSAPP_TEMPLATE_NAME, DEFAULT_WHATSAPP_TEMPLATE);
  const [templateLang, langSrc] = pick(saved.templateLang, env.WHATSAPP_TEMPLATE_LANG, "es");
  const complete = Boolean(token && phoneNumberId && templateName);
  const enabled = saved.enabled ?? complete;
  return {
    active: complete && enabled,
    complete,
    enabled,
    token,
    phoneNumberId,
    templateName,
    templateLang,
    templateLangEn: saved.templateLangEn,
    codeTemplateName: saved.codeTemplateName || DEFAULT_WHATSAPP_CODE_TEMPLATE,
    codeTemplateLang: saved.codeTemplateLang || templateLang,
    codeTemplateLangEn: saved.codeTemplateLangEn,
    apiVersion: clean(env.WHATSAPP_API_VERSION) || DEFAULT_WHATSAPP_API_VERSION,
    // Antes de poder configurarse en Ajustes, la plantilla solo podía venir de WHATSAPP_TEMPLATE_NAME y tenía 4 variables
    // (fuera cual fuera su nombre). Mientras siga saliendo de ahí, se usa ese formato (y solo menciones); al guardar un
    // nombre en Ajustes, el administrador confirma que es la plantilla nueva (salvo que sea la antigua mencion_pizarro).
    legacy: templateName === LEGACY_WHATSAPP_TEMPLATE || templateSrc === "env",
    sources: { token: tokenSrc, phoneNumberId: phoneSrc, templateName: templateSrc, templateLang: langSrc },
  };
}

export const WA_PHONE_ID_RE = /^\d{5,30}$/;
export const WA_TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;
export const WA_LANG_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
export const isWhatsappToken = (s: string) => s.length >= 20 && s.length <= 2000 && /^[A-Za-z0-9_\-.|]+$/.test(s);
export const isTelegramToken = (s: string) => TELEGRAM_TOKEN_RE.test(s);

export interface WhatsappSettingsInput {
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
  templateLangEn: string;
  /** Plantilla de verificación (vacío = codigo_pizarro), su idioma (vacío = el de los avisos) y el de inglés (vacío = el mismo). */
  codeTemplateName?: string;
  codeTemplateLang?: string;
  codeTemplateLangEn?: string;
}

/** Valida y normaliza el formulario de WhatsApp (los campos vacíos usan las variables del servidor o el valor por defecto). */
export function validateWhatsappSettings(input: WhatsappSettingsInput): { ok: true; value: Required<WhatsappSettingsInput> } | { ok: false; error: string } {
  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  const templateName = String(input.templateName ?? "").trim();
  const templateLang = String(input.templateLang ?? "").trim();
  const templateLangEn = String(input.templateLangEn ?? "").trim();
  const codeTemplateName = String(input.codeTemplateName ?? "").trim();
  const codeTemplateLang = String(input.codeTemplateLang ?? "").trim();
  const codeTemplateLangEn = String(input.codeTemplateLangEn ?? "").trim();
  if (phoneNumberId && !WA_PHONE_ID_RE.test(phoneNumberId)) return { ok: false, error: "El identificador del número de WhatsApp son solo cifras (Phone number ID)." };
  for (const name of [templateName, codeTemplateName]) if (name && !WA_TEMPLATE_RE.test(name)) return { ok: false, error: "El nombre de la plantilla solo admite minúsculas, cifras y guiones bajos." };
  for (const lang of [templateLang, templateLangEn, codeTemplateLang, codeTemplateLangEn]) if (lang && !WA_LANG_RE.test(lang)) return { ok: false, error: "El idioma de la plantilla no es válido (por ejemplo es, es_ES o en_US)." };
  return { ok: true, value: { phoneNumberId, templateName, templateLang, templateLangEn, codeTemplateName, codeTemplateLang, codeTemplateLangEn } };
}

/** Texto de una variable de plantilla: Meta no admite saltos de línea, tabuladores ni más de 4 espacios seguidos. */
const param = (text: string, max = 300) => ({ type: "text", text: clip(oneLine(text), max) || "-" });

/**
 * Cuerpo de la petición a la Cloud API. Plantilla actual (aviso_pizarro): {{1}} el aviso con la tarea, {{2}} el
 * proyecto, {{3}} el enlace. La antigua (mencion_pizarro): {{1}} quien menciona, {{2}} la tarea, {{3}} el proyecto, {{4}} el enlace.
 */
export function whatsappPayload(to: string, m: NoticeMessage, cfg: Pick<WhatsappConfig, "templateName" | "templateLang" | "templateLangEn" | "legacy">, t: T, english = false) {
  const parameters = cfg.legacy
    ? [param(m.actorName), param(m.taskTitle), param(m.projectName), param(m.url, 1000)]
    : [param(noticeHeadline(m, t), 400), param(m.projectName, 100), param(m.url, 1000)];
  return {
    messaging_product: "whatsapp",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: cfg.templateName,
      language: { code: (english && cfg.templateLangEn) || cfg.templateLang || "es" },
      components: [{ type: "body", parameters }],
    },
  };
}

/**
 * Idioma con que sale el código de verificación: el de inglés («Idioma en inglés de la verificación») si la persona usa
 * Pizarro en inglés y está configurado; si no, el de la verificación (por defecto, el de los avisos).
 */
export function whatsappCodeLang(cfg: Pick<WhatsappConfig, "codeTemplateLang" | "codeTemplateLangEn">, english: boolean): string {
  return (english && cfg.codeTemplateLangEn) || cfg.codeTemplateLang || "es";
}

/**
 * Cuerpo de la petición del código de verificación con la plantilla de AUTENTICACIÓN (botón «Copiar código»). Formato
 * de Meta: el código va dos veces, como parámetro del cuerpo ({{1}}) y del botón (sub_type «url», índice 0), y como mucho
 * con 15 caracteres. Ver https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
 * (Copy code authentication templates → Sending authentication templates).
 */
export function whatsappCodePayload(to: string, code: string, cfg: Pick<WhatsappConfig, "codeTemplateName" | "codeTemplateLang" | "codeTemplateLangEn">, english = false) {
  const parameters = [{ type: "text", text: code }];
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: cfg.codeTemplateName,
      language: { code: whatsappCodeLang(cfg, english) },
      components: [
        { type: "body", parameters },
        { type: "button", sub_type: "url", index: "0", parameters },
      ],
    },
  };
}

/** Problema de la plantilla de verificación según el error de Meta (ver lib/whatsapp-code-text.ts), o null si es otro fallo. */
export const whatsappTemplateProblem = (err: unknown): CodeTemplateProblem | null => codeTemplateProblem(err instanceof MessagingApiError ? err.code : null);

// --- Preferencias por canal ---

export interface ChannelPrefs {
  notifyMention: boolean;
  notifyAssigned: boolean;
  notifyDue: boolean;
  notifyComment: boolean;
}

export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = { notifyMention: true, notifyAssigned: true, notifyDue: false, notifyComment: false };

/** ¿Quiere esta persona este tipo de aviso por este canal? (mismos grupos que los emails) */
export function channelWants(type: NotificationKind, p: ChannelPrefs): boolean {
  switch (type) {
    case "ASSIGNED": return p.notifyAssigned;
    case "DUE_CHANGED":
    case "WAITING": return p.notifyDue;
    case "COMMENT":
    case "REPLY": return p.notifyComment;
    // Los avisos de administración (un proyecto pasa a ser de equipo) van con las menciones: van dirigidos a la persona,
    // son raros y salen por defecto.
    default: return p.notifyMention;
  }
}

/** ¿Puede salir este aviso por este canal? WhatsApp solo con el número confirmado y, con la plantilla antigua, solo menciones. */
export function channelUsable(ch: { channel: "TELEGRAM" | "WHATSAPP"; verifiedAt: Date | null; consentAt: Date | null }, type: NotificationKind, legacyWhatsapp: boolean): boolean {
  if (ch.channel === "TELEGRAM") return true;
  if (!ch.verifiedAt || !ch.consentAt) return false;
  return !legacyWhatsapp || type === "MENTION";
}

// --- Errores y reintentos ---

/** Error de una API de mensajería con lo necesario para decidir (sin el token ni el destinatario). */
export class MessagingApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec: number | null = null, readonly code: number | null = null) {
    super(message);
    this.name = "MessagingApiError";
  }
}

/** Fallo de red de fetch, con su código (ECONNREFUSED, ENOTFOUND…) y el mensaje ya sin secretos. */
export class MessagingNetworkError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "MessagingNetworkError";
  }
}

/** Código de un error de red de fetch (undici lo deja en `cause.code`). */
export function networkErrorCode(err: unknown): string | null {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Errores de red en los que la petición no llegó a salir (no se pudo resolver el nombre ni abrir la conexión). Con
 * WhatsApp solo se reintentan estos: un ECONNRESET o un 5xx pueden llegar después de que Meta aceptara (y cobrara) el
 * mensaje, y repetirlo lo enviaría (y cobraría) dos veces.
 */
export const PRE_SEND_NETWORK_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

/** Qué hacer tras un fallo: reintentar, dar el canal por desconectado (bot bloqueado, chat borrado) o rendirse. */
export function classifyFailure(channel: "TELEGRAM" | "WHATSAPP", err: unknown): "retry" | "disconnect" | "fail" {
  if (!(err instanceof MessagingApiError)) {
    // Telegram es gratis y un aviso repetido no cuesta nada: cualquier fallo de red se reintenta.
    if (channel === "TELEGRAM") return "retry";
    const code = err instanceof MessagingNetworkError ? err.code : networkErrorCode(err);
    return code && PRE_SEND_NETWORK_CODES.has(code) ? "retry" : "fail";
  }
  // Tiempo agotado: en WhatsApp puede haberse enviado (y cobrado), así que no se repite; en Telegram, sí.
  if (err.status === 408) return channel === "TELEGRAM" ? "retry" : "fail";
  if (err.status === 429) return "retry";
  // 5xx: en WhatsApp, Meta puede haberlo enviado igualmente; no se repite.
  if (err.status >= 500) return channel === "TELEGRAM" ? "retry" : "fail";
  if (channel === "TELEGRAM" && (err.status === 403 || (err.status === 400 && /chat not found|user is deactivated|bot was blocked/i.test(err.message)))) return "disconnect";
  return "fail";
}

/** Quita secretos de un texto de error (el token del bot va en la URL de la API de Telegram). */
export function scrubSecrets(text: string, secrets: string[]): string {
  let s = String(text ?? "");
  for (const secret of secrets) if (secret && secret.length >= 6) s = s.split(secret).join("***");
  s = s.replace(/bot\d{4,20}:[A-Za-z0-9_-]{20,}/g, "bot***").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 300 ? `${s.slice(0, 300)}…` : s || "Error desconocido";
}

/** Teléfono para los registros: «+34******222». */
export function maskPhone(phone: string): string {
  const p = phone.replace(/\s+/g, "");
  if (p.length <= 6) return "***";
  return `${p.slice(0, 3)}${"*".repeat(Math.max(3, p.length - 6))}${p.slice(-3)}`;
}

export const last4 = (s: string) => (s.length >= 8 ? s.slice(-4) : "");

/**
 * Reintentos limitados: `attempts` intentos en total, con las esperas de `delaysMs` entre ellos (o el Retry-After de
 * la API si es corto). No reintenta lo que no tiene arreglo, ni espera si el proceso se está apagando.
 */
export async function withRetries<T>(
  channel: "TELEGRAM" | "WHATSAPP",
  fn: () => Promise<T>,
  opts: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; stopping?: () => boolean; maxRetryAfterSec?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [1_000, 4_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (classifyFailure(channel, err) !== "retry" || i === attempts - 1 || opts.stopping?.()) throw err;
      const retryAfter = err instanceof MessagingApiError ? err.retryAfterSec : null;
      if (retryAfter !== null && retryAfter > (opts.maxRetryAfterSec ?? 10)) throw err;
      await sleep(retryAfter !== null ? retryAfter * 1000 : delays[Math.min(i, delays.length - 1)] ?? 1_000);
    }
  }
  throw lastErr;
}

/** Envíos por canal y persona en una hora, como mucho (WhatsApp cuesta dinero: menos). */
export const CHANNEL_LIMIT_PER_HOUR = { TELEGRAM: 30, WHATSAPP: 10 } as const;
/** Espera antes de volver a preparar el bot tras un fallo (n = fallos seguidos): 5 s, 10 s, 20 s… hasta 5 minutos. */
export const telegramSyncRetryMs = (n: number, baseMs = 5_000) => Math.min(5 * 60_000, baseMs * 2 ** Math.max(0, Math.min(n - 1, 20)));

/** Código de verificación de WhatsApp: 6 cifras, válido 15 minutos y 5 intentos. */
export const WHATSAPP_CODE_MINUTES = 15;
export const WHATSAPP_CODE_ATTEMPTS = 5;
/**
 * Mensajes de prueba o con código desde Mi perfil, al día (cada uno cuesta dinero y llega a un número que todavía no
 * se ha comprobado): por persona y por número de destino, sea quien sea quien lo pida.
 */
export const WHATSAPP_TESTS_PER_DAY = { user: 5, number: 3 } as const;

/** «123456» → solo 6 cifras (admite espacios o guiones al copiarlo). */
export function normalizeWhatsappCode(input: unknown): string | null {
  const s = String(input ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(s) ? s : null;
}

/** Minutos de validez del código de «Conectar Telegram». */
export const TELEGRAM_LINK_MINUTES = 10;
/** Tamaño máximo del cuerpo que se acepta en el webhook de Telegram. */
export const TELEGRAM_WEBHOOK_MAX_BYTES = 64 * 1024;

/** Texto exacto del cuerpo de la plantilla aviso_pizarro que hay que crear en Meta (docs/guias/whatsapp.md). */
export const WHATSAPP_TEMPLATE_BODY = {
  es: "Aviso de Pizarro: {{1}} (proyecto {{2}}).\n\nÁbrelo aquí: {{3}}\n\nPuedes cambiar estos avisos en Mi perfil de Pizarro.",
  en: "Pizarro notice: {{1}} (project {{2}}).\n\nOpen it here: {{3}}\n\nYou can change these notices in your Pizarro profile.",
} as const;

/** Muestra del código para la prueba de Ajustes (no sirve para nada: solo comprueba la plantilla de verificación). */
export const WHATSAPP_SAMPLE_CODE = "123456";

/** Página de precios de WhatsApp Business de Meta. */
export const WHATSAPP_PRICING_URL = "https://developers.facebook.com/docs/whatsapp/pricing";
