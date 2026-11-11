"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appUrl } from "@/lib/mail";
import { getMyChannels } from "@/lib/messaging";
import { clearTelegram, loadMessagingConfig, saveTelegramToken, saveWhatsappSettings as persistWhatsapp, setTelegramEnabled, setWhatsappEnabled } from "@/lib/messaging-config";
import { escapeTelegramHtml, isTelegramToken, isWhatsappToken, maskPhone, scrubSecrets, telegramStartUrl, validateWhatsappSettings, type WhatsappSettingsInput } from "@/lib/messaging-core";
import { rateLimit } from "@/lib/rate-limit";
import { requireAdmin, requireUser } from "@/lib/session";
import { createTelegramLinkCode, getBot, sendTelegramMessage, syncTelegram } from "@/lib/telegram";
import * as v from "@/lib/validation";
import { sendWhatsappNotice } from "@/lib/whatsapp";
import { getT } from "@/i18n/server";
import { toLocale } from "@/i18n/core";

// Telegram y WhatsApp: Administración → Ajustes (solo administradores) y Mi perfil → Avisos (cada persona).
// Los tokens nunca se registran ni se devuelven: los args de las acciones de administración NO se pasan a runAction.

const channelSchema = z.enum(["TELEGRAM", "WHATSAPP"]);
const prefsSchema = z.object({ notifyMention: z.boolean(), notifyAssigned: z.boolean(), notifyDue: z.boolean(), notifyComment: z.boolean() });

async function apiFailure(prefix: string, err: unknown, secrets: string[]): Promise<AppError> {
  const t = await getT();
  return new AppError(`${t(prefix)} ${scrubSecrets((err as Error)?.message ?? String(err), secrets)}`);
}

// --- Administración: Telegram ---

/** Guarda (y activa) el bot: comprueba el token con Telegram, lo guarda cifrado y registra el webhook o el sondeo. */
export async function saveTelegramBot(input: { token: string }) {
  return runAction({ name: "settings.saveTelegram" }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`messaging:admin:${admin.id}`, 20, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const token = String(input?.token ?? "").trim();
    if (!isTelegramToken(token)) throw new AppError("El token no tiene el formato que da @BotFather (números, dos puntos y letras).");
    let bot;
    try {
      bot = await getBot(token);
    } catch (err) {
      throw await apiFailure("Telegram no acepta este token.", err, [token]);
    }
    const before = (await loadMessagingConfig({ fresh: true })).telegramSettings;
    // Otro bot: los chats enlazados eran con el anterior y el nuevo no puede escribirles hasta que cada persona lo abra.
    let reset = 0;
    if (before.botId && before.botId !== bot.id) {
      reset = (await db.userChannel.deleteMany({ where: { channel: "TELEGRAM" } })).count;
      await db.telegramLinkCode.deleteMany({});
    }
    await saveTelegramToken(token, { username: bot.username, id: bot.id });
    await setTelegramEnabled(true);
    const sync = await syncTelegram();
    describeAction("Configuró el bot de Telegram @{bot}", { bot: bot.username }, { mode: sync.mode, syncError: sync.error, reconnectNeeded: reset });
    revalidatePath("/admin/settings");
    return { bot: bot.username, mode: sync.mode, error: sync.error, reset };
  });
}

export async function setTelegramActive(enabled: boolean) {
  return runAction({ name: "settings.setTelegramActive", args: [enabled] }, async () => {
    await requireAdmin();
    const cfg = await loadMessagingConfig({ fresh: true });
    if (enabled && !cfg.telegramSettings.hasToken) throw new AppError("Pega primero el token del bot.");
    await setTelegramEnabled(Boolean(enabled));
    const sync = await syncTelegram();
    describeAction(enabled ? "Activó los avisos por Telegram" : "Desactivó los avisos por Telegram", { mode: sync.mode, syncError: sync.error });
    revalidatePath("/admin/settings");
    return { mode: sync.mode, error: sync.error };
  });
}

/** Quita el bot: deja de recibir sus mensajes (quita el webhook), borra el token y desconecta a todos. */
export async function removeTelegramBot() {
  return runAction({ name: "settings.removeTelegram" }, async () => {
    await requireAdmin();
    await setTelegramEnabled(false);
    await syncTelegram();
    await clearTelegram();
    const { count } = await db.userChannel.deleteMany({ where: { channel: "TELEGRAM" } });
    await db.telegramLinkCode.deleteMany({});
    describeAction("Quitó el bot de Telegram", { disconnected: count });
    revalidatePath("/admin/settings");
    return { disconnected: count };
  });
}

/** Comprueba el bot guardado (getMe) y, si el administrador tiene Telegram conectado, le manda un mensaje de prueba. */
export async function testTelegram() {
  return runAction({ name: "settings.testTelegram" }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`messaging:test:${admin.id}`, 5, 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const cfg = await loadMessagingConfig({ fresh: true });
    if (!cfg.telegram.token) throw new AppError("Pega primero el token del bot.");
    const t = await getT();
    let bot;
    try {
      bot = await getBot(cfg.telegram.token);
    } catch (err) {
      throw await apiFailure("Telegram no acepta el token guardado.", err, [cfg.telegram.token]);
    }
    const mine = await db.userChannel.findUnique({ where: { userId_channel: { userId: admin.id, channel: "TELEGRAM" } }, select: { address: true } });
    let sentToYou = false;
    if (mine && cfg.telegram.active) {
      try {
        await sendTelegramMessage(cfg.telegram.token, mine.address, `<b>${escapeTelegramHtml(t("Mensaje de prueba de Pizarro"))}</b>\n${escapeTelegramHtml(t("Si lo lees, los avisos por Telegram funcionan."))}`);
        sentToYou = true;
      } catch (err) {
        throw await apiFailure("El bot responde, pero no se pudo enviarte el mensaje de prueba.", err, [cfg.telegram.token]);
      }
    }
    describeAction("Probó el bot de Telegram @{bot}", { bot: bot.username }, { sentToYou });
    return { bot: bot.username, sentToYou };
  });
}

// --- Administración: WhatsApp ---

export interface WhatsappForm extends WhatsappSettingsInput {
  /** Token nuevo; vacío o ausente = conservar el guardado. */
  token?: string;
  /** Borrar el token guardado (vuelve a usarse WHATSAPP_TOKEN, si el servidor la define). */
  clearToken?: boolean;
}

export async function saveWhatsappSettings(form: WhatsappForm) {
  return runAction({ name: "settings.saveWhatsapp" }, async () => {
    await requireAdmin();
    const checked = validateWhatsappSettings(form);
    if (!checked.ok) throw new AppError(checked.error);
    const token = typeof form.token === "string" ? form.token.trim() : "";
    if (token && !isWhatsappToken(token)) throw new AppError("El token de WhatsApp no es válido.");
    const change = await persistWhatsapp(checked.value, { token, clearToken: Boolean(form.clearToken) });
    const cfg = (await loadMessagingConfig({ fresh: true })).whatsapp;
    describeAction("Cambió la configuración de WhatsApp", { template: cfg.templateName, lang: cfg.templateLang, langEn: checked.value.templateLangEn || null, complete: cfg.complete, active: cfg.active, authChange: change });
    revalidatePath("/admin/settings");
    return { complete: cfg.complete, active: cfg.active };
  });
}

export async function setWhatsappActive(enabled: boolean) {
  return runAction({ name: "settings.setWhatsappActive", args: [enabled] }, async () => {
    await requireAdmin();
    const cfg = (await loadMessagingConfig({ fresh: true })).whatsapp;
    if (enabled && !cfg.complete) throw new AppError("Faltan datos: el token, el identificador del número y la plantilla.");
    await setWhatsappEnabled(Boolean(enabled));
    describeAction(enabled ? "Activó los avisos por WhatsApp" : "Desactivó los avisos por WhatsApp");
    revalidatePath("/admin/settings");
  });
}

/** Envía la plantilla, con un texto de prueba, a un número que indica el administrador (con la configuración guardada). */
export async function testWhatsapp(input: { to: string }) {
  return runAction({ name: "settings.testWhatsapp" }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`messaging:test:${admin.id}`, 5, 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const to = v.phoneE164.parse(input?.to ?? "");
    if (!to) throw new AppError("Escribe el número al que enviar la prueba.");
    const cfg = (await loadMessagingConfig({ fresh: true })).whatsapp;
    if (!cfg.complete) throw new AppError("Faltan datos: el token, el identificador del número y la plantilla.");
    await sendTest(cfg, to, admin.locale);
    describeAction("Envió un WhatsApp de prueba a {to}", { to: maskPhone(to) });
    return { to: maskPhone(to) };
  });
}

async function sendTest(cfg: Awaited<ReturnType<typeof loadMessagingConfig>>["whatsapp"], to: string, locale: string) {
  const t = await getT();
  try {
    await sendWhatsappNotice(cfg, to, {
      headline: t("Mensaje de prueba de Pizarro: si lo lees, los avisos por WhatsApp funcionan"),
      actorName: "Pizarro",
      taskTitle: t("Mensaje de prueba"),
      projectName: "Pizarro",
      excerpt: "",
      url: `${appUrl()}/settings?tab=avisos`,
    }, t, toLocale(locale) === "en");
  } catch (err) {
    throw await apiFailure("No se pudo enviar el WhatsApp de prueba.", err, [cfg.token, to]);
  }
}

// --- Mi perfil → Avisos ---

export async function myChannels() {
  // Sin registro: la pantalla lo consulta cada pocos segundos mientras espera a que se conecte Telegram.
  return runAction(async () => {
    const user = await requireUser();
    return getMyChannels(user.id);
  });
}

/** Enlace de un solo uso para abrir el bot (y su QR, para escanearlo con el móvil desde el ordenador). */
export async function connectTelegram() {
  return runAction({ name: "profile.connectTelegram", args: [] }, async () => {
    const user = await requireUser();
    if (!rateLimit(`telegram:link-code:${user.id}`, 10, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const cfg = await loadMessagingConfig();
    if (!cfg.telegram.active) throw new AppError("Los avisos por Telegram no están activados en esta instalación.");
    const { code, expiresAt } = await createTelegramLinkCode(user.id);
    const url = telegramStartUrl(cfg.telegram.botUsername, code);
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { url, expiresAt: expiresAt.toISOString(), qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
  });
}

export async function disconnectChannel(channel: "TELEGRAM" | "WHATSAPP") {
  return runAction({ name: "profile.disconnectChannel", args: [channel] }, async () => {
    const user = await requireUser();
    const ch = channelSchema.parse(channel);
    await db.userChannel.deleteMany({ where: { userId: user.id, channel: ch } });
    if (ch === "TELEGRAM") await db.telegramLinkCode.deleteMany({ where: { userId: user.id } });
    describeAction(ch === "TELEGRAM" ? "Desconectó Telegram" : "Desconectó WhatsApp");
    revalidatePath("/settings");
  });
}

export async function saveChannelPrefs(channel: "TELEGRAM" | "WHATSAPP", prefs: z.input<typeof prefsSchema>) {
  return runAction({ name: "profile.saveChannelPrefs", args: [channel, prefs] }, async () => {
    const user = await requireUser();
    const ch = channelSchema.parse(channel);
    const data = prefsSchema.parse(prefs);
    const { count } = await db.userChannel.updateMany({ where: { userId: user.id, channel: ch }, data });
    if (!count) throw new AppError("Conecta primero este canal.");
  });
}

/** Número de WhatsApp con consentimiento explícito. Al cambiarlo queda sin confirmar y se envía un mensaje de prueba. */
export async function saveMyWhatsapp(input: { phone: string; consent: boolean }) {
  // Sin args: el registro no guarda el número completo.
  return runAction({ name: "profile.saveWhatsapp" }, async () => {
    const user = await requireUser();
    if (!rateLimit(`whatsapp:number:${user.id}`, 5, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const phone = v.phoneE164.parse(input?.phone ?? "");
    if (!phone) throw new AppError("Indica tu número de WhatsApp para activar los avisos.");
    if (input?.consent !== true) throw new AppError("Marca la casilla para aceptar recibir avisos por WhatsApp.");
    const cfg = (await loadMessagingConfig()).whatsapp;
    if (!cfg.active) throw new AppError("Los avisos por WhatsApp no están activados en esta instalación.");
    const now = new Date();
    const prev = await db.userChannel.findUnique({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } }, select: { address: true, verifiedAt: true } });
    const same = prev?.address === phone;
    await db.userChannel.upsert({
      where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } },
      create: { userId: user.id, channel: "WHATSAPP", address: phone, consentAt: now },
      update: { address: phone, consentAt: now, ...(same ? {} : { verifiedAt: null }) },
    });
    describeAction("Guardó su número de WhatsApp {to}", { to: maskPhone(phone) });
    if (same && prev?.verifiedAt) return { verified: true, sent: false };
    await sendTest(cfg, phone, user.locale);
    return { verified: false, sent: true };
  });
}

/** La persona confirma que le llegó el mensaje de prueba: desde ahora recibe avisos por WhatsApp. */
export async function confirmMyWhatsapp() {
  return runAction({ name: "profile.confirmWhatsapp", args: [] }, async () => {
    const user = await requireUser();
    const { count } = await db.userChannel.updateMany({ where: { userId: user.id, channel: "WHATSAPP", consentAt: { not: null } }, data: { verifiedAt: new Date() } });
    if (!count) throw new AppError("Guarda primero tu número de WhatsApp.");
    describeAction("Confirmó su número de WhatsApp");
    revalidatePath("/settings");
  });
}

/** Mensaje de prueba a uno mismo por un canal conectado. */
export async function testMyChannel(channel: "TELEGRAM" | "WHATSAPP") {
  return runAction({ name: "profile.testChannel", args: [channel] }, async () => {
    const user = await requireUser();
    const ch = channelSchema.parse(channel);
    if (!rateLimit(`messaging:mytest:${user.id}`, 5, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const row = await db.userChannel.findUnique({ where: { userId_channel: { userId: user.id, channel: ch } }, select: { address: true } });
    if (!row) throw new AppError("Conecta primero este canal.");
    const cfg = await loadMessagingConfig();
    const t = await getT();
    if (ch === "TELEGRAM") {
      if (!cfg.telegram.active) throw new AppError("Los avisos por Telegram no están activados en esta instalación.");
      try {
        await sendTelegramMessage(cfg.telegram.token, row.address, `<b>${escapeTelegramHtml(t("Mensaje de prueba de Pizarro"))}</b>\n${escapeTelegramHtml(t("Si lo lees, los avisos por Telegram funcionan."))}`);
      } catch (err) {
        throw await apiFailure("No se pudo enviar el mensaje de prueba.", err, [cfg.telegram.token]);
      }
    } else {
      if (!cfg.whatsapp.active) throw new AppError("Los avisos por WhatsApp no están activados en esta instalación.");
      await sendTest(cfg.whatsapp, row.address, user.locale);
    }
  });
}
