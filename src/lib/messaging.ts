import "server-only";
import { db } from "./db";
import { appUrl } from "./mail";
import { loadMessagingConfig } from "./messaging-config";
import { DEFAULT_WHATSAPP_TEMPLATE, telegramMode, WHATSAPP_CODE_ATTEMPTS, WHATSAPP_PRICING_URL, WHATSAPP_TEMPLATE_BODY, type ChannelPrefs, type Source } from "./messaging-core";
import { telegramStatus, webhookInfo } from "./telegram";

// Lo que ven las pantallas de Telegram y WhatsApp: Administración → Ajustes («Telegram y WhatsApp») y Mi perfil → Avisos.
// Nunca llevan un token: como mucho, sus 4 últimos caracteres.

export interface MessagingAdminView {
  appUrl: string;
  telegram: {
    hasToken: boolean;
    tokenLast4: string;
    enabled: boolean;
    active: boolean;
    botUsername: string;
    mode: "webhook" | "polling";
    modeReason: ReturnType<typeof telegramMode>["reason"];
    webhookUrl: string | null;
    /** Último error al registrar el webhook o al preguntar a Telegram (sin el token). */
    lastError: string | null;
    /** Último error que Telegram tuvo al llamar al webhook (24 h). */
    deliveryError: string | null;
    connected: number;
  };
  whatsapp: {
    phoneNumberId: string;
    templateName: string;
    templateLang: string;
    templateLangEn: string;
    hasSavedToken: boolean;
    tokenLast4: string;
    /** Valores de las variables WHATSAPP_* (sin el token): se usan en los campos vacíos. */
    env: { token: boolean; phoneNumberId: string; templateName: string; templateLang: string };
    sources: Record<"token" | "phoneNumberId" | "templateName" | "templateLang", Source>;
    effective: { phoneNumberId: string; templateName: string; templateLang: string };
    enabled: boolean;
    complete: boolean;
    active: boolean;
    legacy: boolean;
    /** De dónde sale el formato antiguo: el nombre mencion_pizarro o la variable WHATSAPP_TEMPLATE_NAME. */
    legacyFromEnv: boolean;
    connected: number;
    pending: number;
    /** Texto de la plantilla que hay que crear en Meta, nombre por defecto y página de precios (el cliente no importa messaging-core). */
    templateBody: { es: string; en: string };
    defaultTemplate: string;
    pricingUrl: string;
  };
}

export async function getMessagingAdminView(): Promise<MessagingAdminView> {
  const cfg = await loadMessagingConfig({ fresh: true });
  const m = telegramMode(process.env.APP_URL);
  const counts = await db.userChannel.groupBy({ by: ["channel"], where: { user: { active: true } }, _count: { _all: true } });
  // Pendientes: dieron su número y su consentimiento pero aún no han escrito el código. Los números que vienen de una
  // versión anterior sin avisos activados (sin consentimiento) no cuentan ni como conectados ni como pendientes.
  const pending = await db.userChannel.count({ where: { channel: "WHATSAPP", verifiedAt: null, consentAt: { not: null }, user: { active: true } } });
  const verified = await db.userChannel.count({ where: { channel: "WHATSAPP", verifiedAt: { not: null }, consentAt: { not: null }, user: { active: true } } });
  const count = (c: "TELEGRAM" | "WHATSAPP") => counts.find((r) => r.channel === c)?._count._all ?? 0;
  const status = telegramStatus();
  const info = cfg.telegram.active && m.mode === "webhook" ? await webhookInfo(cfg.telegram.token) : null;
  const w = cfg.whatsapp;
  const ws = cfg.whatsappSettings;
  const env = process.env;
  return {
    appUrl: (env.APP_URL ?? "").trim().replace(/\/$/, ""),
    telegram: {
      hasToken: cfg.telegramSettings.hasToken,
      tokenLast4: cfg.telegramSettings.tokenLast4,
      enabled: cfg.telegramSettings.enabled,
      active: cfg.telegram.active,
      botUsername: cfg.telegramSettings.botUsername,
      mode: m.mode,
      modeReason: m.reason,
      webhookUrl: m.webhookUrl,
      lastError: cfg.telegram.active ? status.lastError : null,
      deliveryError: info?.lastError || null,
      connected: count("TELEGRAM"),
    },
    whatsapp: {
      phoneNumberId: ws.phoneNumberId,
      templateName: ws.templateName,
      templateLang: ws.templateLang,
      templateLangEn: ws.templateLangEn,
      hasSavedToken: ws.hasToken,
      tokenLast4: ws.tokenLast4,
      env: { token: Boolean(env.WHATSAPP_TOKEN?.trim()), phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "", templateName: env.WHATSAPP_TEMPLATE_NAME?.trim() ?? "", templateLang: env.WHATSAPP_TEMPLATE_LANG?.trim() ?? "" },
      sources: w.sources,
      effective: { phoneNumberId: w.phoneNumberId, templateName: w.templateName, templateLang: w.templateLang },
      enabled: w.enabled,
      complete: w.complete,
      active: w.active,
      legacy: w.legacy,
      legacyFromEnv: w.legacy && w.sources.templateName === "env",
      connected: verified,
      pending,
      templateBody: { ...WHATSAPP_TEMPLATE_BODY },
      defaultTemplate: DEFAULT_WHATSAPP_TEMPLATE,
      pricingUrl: WHATSAPP_PRICING_URL,
    },
  };
}

export interface MyChannelsView {
  telegram: { available: boolean; botUsername: string; connected: boolean; label: string; prefs: ChannelPrefs } | null;
  whatsapp: {
    available: boolean;
    phone: string;
    verified: boolean;
    /** Aceptó recibir avisos (un número que viene de una versión anterior con WhatsApp desactivado, no). */
    consented: boolean;
    /** Hay un código enviado que aún vale (sin caducar ni gastar sus intentos). */
    codePending: boolean;
    prefs: ChannelPrefs;
    mentionsOnly: boolean;
  } | null;
  /** Dirección de la app (para el texto de ayuda). */
  appUrl: string;
}

const prefsOf = (r: ChannelPrefs): ChannelPrefs => ({ notifyMention: r.notifyMention, notifyAssigned: r.notifyAssigned, notifyDue: r.notifyDue, notifyComment: r.notifyComment });
const DEFAULT: ChannelPrefs = { notifyMention: true, notifyAssigned: true, notifyDue: false, notifyComment: false };

/** Canales de una persona. Cada canal aparece si el administrador lo ha activado o si la persona ya lo tenía conectado. */
export async function getMyChannels(userId: string): Promise<MyChannelsView> {
  const [cfg, rows] = await Promise.all([loadMessagingConfig(), db.userChannel.findMany({ where: { userId } })]);
  const tg = rows.find((r) => r.channel === "TELEGRAM");
  const wa = rows.find((r) => r.channel === "WHATSAPP");
  return {
    appUrl: appUrl(),
    telegram: cfg.telegram.active || tg
      ? { available: cfg.telegram.active, botUsername: cfg.telegram.botUsername, connected: Boolean(tg), label: tg?.label ?? "", prefs: tg ? prefsOf(tg) : DEFAULT }
      : null,
    whatsapp: cfg.whatsapp.active || wa
      ? {
          available: cfg.whatsapp.active,
          phone: wa?.address ?? "",
          verified: Boolean(wa?.verifiedAt && wa.consentAt),
          consented: Boolean(wa?.consentAt),
          codePending: Boolean(wa?.verifyCodeHash && wa.verifyExpiresAt && wa.verifyExpiresAt.getTime() > Date.now() && wa.verifyAttempts < WHATSAPP_CODE_ATTEMPTS),
          prefs: wa ? prefsOf(wa) : DEFAULT,
          mentionsOnly: cfg.whatsapp.legacy,
        }
      : null,
  };
}
