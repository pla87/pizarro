"use server";

import { randomInt } from "node:crypto";
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
import {
  isTelegramToken, isWhatsappToken, maskPhone, normalizeWhatsappCode, safeEqual, scrubSecrets, telegramStartUrl, telegramTestText, validateWhatsappSettings,
  WHATSAPP_CODE_ATTEMPTS, WHATSAPP_CODE_MINUTES, WHATSAPP_TESTS_PER_DAY, type WhatsappSettingsInput,
} from "@/lib/messaging-core";
import { labelledHmac, labelledHmacCandidates } from "@/lib/keyring";
import { rateLimit, rateLimitReached } from "@/lib/rate-limit";
import { requireAdmin, requireUser } from "@/lib/session";
import { createTelegramLinkCode, getBot, releaseTelegramBot, sendTelegramMessage, syncTelegram } from "@/lib/telegram";
import * as v from "@/lib/validation";
import { sendWhatsappNotice } from "@/lib/whatsapp";
import { getT } from "@/i18n/server";
import { makeT, toLocale } from "@/i18n/core";

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
    const prev = await loadMessagingConfig({ fresh: true });
    const before = prev.telegramSettings;
    // Otro bot: los chats enlazados eran con el anterior y el nuevo no puede escribirles hasta que cada persona lo abra.
    let reset = 0;
    if (before.botId && before.botId !== bot.id) {
      reset = (await db.userChannel.deleteMany({ where: { channel: "TELEGRAM" } })).count;
      await db.telegramLinkCode.deleteMany({});
      // El bot anterior deja de llamar a Pizarro (su webhook seguiría puesto). El secreto del webhook se cambia al
      // guardar (saveTelegramToken) y el sondeo se reinicia con el token nuevo (syncTelegram).
      if (prev.telegram.token && prev.telegram.token !== token) await releaseTelegramBot(prev.telegram.token);
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
        await sendTelegramMessage(cfg.telegram.token, mine.address, telegramTestText(t));
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

type WhatsappCfg = Awaited<ReturnType<typeof loadMessagingConfig>>["whatsapp"];

/** Envía la plantilla con `headline` como texto del aviso ({{1}}; con la plantilla antigua, como «tarea»). */
async function sendTemplateText(cfg: WhatsappCfg, to: string, locale: string, text: string, errorPrefix: string) {
  const t = makeT(toLocale(locale));
  try {
    await sendWhatsappNotice(cfg, to, {
      headline: text,
      actorName: "Pizarro",
      taskTitle: text,
      projectName: "Pizarro",
      excerpt: "",
      url: `${appUrl()}/settings?tab=avisos`,
    }, t, toLocale(locale) === "en");
  } catch (err) {
    throw await apiFailure(errorPrefix, err, [cfg.token, to, to.replace(/^\+/, "")]);
  }
}

async function sendTest(cfg: WhatsappCfg, to: string, locale: string) {
  const t = makeT(toLocale(locale));
  await sendTemplateText(cfg, to, locale, t("Mensaje de prueba de Pizarro: si lo lees, los avisos por WhatsApp funcionan"), "No se pudo enviar el WhatsApp de prueba.");
}

// --- Código de verificación de WhatsApp (Mi perfil) ---

const DAY_MS = 24 * 3600_000;
const codeHashInput = (userId: string, phone: string, code: string) => `${userId}:${phone}:${code}`;
const testKeys = (userId: string, phone: string) => ({
  user: `whatsapp:test:user:${userId}`,
  // Por número de destino, sea quien sea quien lo pida (sin guardar el número en claro en memoria).
  number: `whatsapp:test:to:${labelledHmac("whatsapp-test", phone)}`,
});

/**
 * Cada mensaje de prueba o con código cuesta dinero y llega a un número que quizá no es de quien lo pide: como mucho
 * WHATSAPP_TESTS_PER_DAY por persona y por número al día. Se comprueba antes de guardar nada y se cuenta al enviar.
 */
async function reserveWhatsappTest(userId: string, phone: string): Promise<void> {
  const k = testKeys(userId, phone);
  if (rateLimitReached(k.user, WHATSAPP_TESTS_PER_DAY.user) || rateLimitReached(k.number, WHATSAPP_TESTS_PER_DAY.number)) {
    throw new AppError("Has llegado al máximo de mensajes de WhatsApp de prueba por hoy. Vuelve a intentarlo mañana.", 429);
  }
  rateLimit(k.user, WHATSAPP_TESTS_PER_DAY.user, DAY_MS);
  rateLimit(k.number, WHATSAPP_TESTS_PER_DAY.number, DAY_MS);
}

/** Genera un código nuevo (anula el anterior), lo guarda como HMAC con su caducidad y lo envía por WhatsApp. */
async function issueWhatsappCode(cfg: WhatsappCfg, user: { id: string; locale: string }, phone: string): Promise<void> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expires = new Date(Date.now() + WHATSAPP_CODE_MINUTES * 60_000);
  await db.userChannel.update({
    where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } },
    data: { verifiedAt: null, verifyCodeHash: labelledHmac("whatsapp-verify", codeHashInput(user.id, phone, code)), verifyExpiresAt: expires, verifyAttempts: 0 },
  });
  const t = makeT(toLocale(user.locale));
  await sendTemplateText(cfg, phone, user.locale, t("Tu código de verificación de Pizarro es {code}", { code }), "No se pudo enviar el código por WhatsApp.");
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

/**
 * Número de WhatsApp con consentimiento explícito. Un número nuevo (o sin confirmar) queda pendiente y recibe un código
 * de 6 cifras que hay que escribir en Mi perfil: así nadie puede apuntar avisos de pago al número de otra persona.
 */
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
    const prev = await db.userChannel.findUnique({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } }, select: { address: true, verifiedAt: true, consentAt: true } });
    if (prev?.address === phone && prev.verifiedAt && prev.consentAt) {
      await db.userChannel.update({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } }, data: { consentAt: now } });
      describeAction("Guardó su número de WhatsApp {to}", { to: maskPhone(phone) });
      return { verified: true, sent: false };
    }
    await reserveWhatsappTest(user.id, phone);
    await db.userChannel.upsert({
      where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } },
      create: { userId: user.id, channel: "WHATSAPP", address: phone, consentAt: now },
      update: { address: phone, consentAt: now, verifiedAt: null },
    });
    describeAction("Guardó su número de WhatsApp {to}", { to: maskPhone(phone) });
    await issueWhatsappCode(cfg, user, phone);
    return { verified: false, sent: true };
  });
}

/** Otro código para el número pendiente (el anterior deja de valer). */
export async function resendMyWhatsappCode() {
  return runAction({ name: "profile.resendWhatsappCode", args: [] }, async () => {
    const user = await requireUser();
    const row = await db.userChannel.findUnique({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } }, select: { address: true, verifiedAt: true, consentAt: true } });
    if (!row?.consentAt) throw new AppError("Guarda primero tu número de WhatsApp.");
    if (row.verifiedAt) throw new AppError("Tu número de WhatsApp ya está confirmado.");
    const cfg = (await loadMessagingConfig()).whatsapp;
    if (!cfg.active) throw new AppError("Los avisos por WhatsApp no están activados en esta instalación.");
    await reserveWhatsappTest(user.id, row.address);
    await issueWhatsappCode(cfg, user, row.address);
    describeAction("Pidió otro código de WhatsApp para {to}", { to: maskPhone(row.address) });
  });
}

/**
 * La persona escribe el código que le llegó: desde ahora recibe avisos por WhatsApp. El código caduca a los
 * WHATSAPP_CODE_MINUTES y admite WHATSAPP_CODE_ATTEMPTS intentos; después hay que pedir otro.
 */
export async function confirmMyWhatsapp(input: { code: string }) {
  // Sin args: el código no va al registro.
  return runAction({ name: "profile.confirmWhatsapp" }, async () => {
    const user = await requireUser();
    const t = await getT();
    const code = normalizeWhatsappCode(input?.code);
    if (!code) throw new AppError("Escribe el código de 6 cifras que te ha llegado por WhatsApp.");
    const where = { userId_channel: { userId: user.id, channel: "WHATSAPP" as const } };
    const row = await db.userChannel.findUnique({ where, select: { id: true, address: true, consentAt: true, verifiedAt: true, verifyCodeHash: true, verifyExpiresAt: true, verifyAttempts: true } });
    if (!row?.consentAt) throw new AppError("Guarda primero tu número de WhatsApp.");
    if (row.verifiedAt) return { verified: true };
    if (!row.verifyCodeHash || !row.verifyExpiresAt || row.verifyExpiresAt.getTime() <= Date.now()) {
      throw new AppError("El código ha caducado o ya no vale. Pide otro con «Enviar otro código».");
    }
    // Se gasta el intento antes de comparar y de forma atómica: dos intentos a la vez no se saltan el tope.
    const spent = await db.userChannel.updateMany({ where: { id: row.id, verifyCodeHash: row.verifyCodeHash, verifyAttempts: { lt: WHATSAPP_CODE_ATTEMPTS } }, data: { verifyAttempts: { increment: 1 } } });
    if (!spent.count) {
      await db.userChannel.updateMany({ where: { id: row.id, verifyCodeHash: row.verifyCodeHash }, data: { verifyCodeHash: null, verifyExpiresAt: null } });
      throw new AppError("Demasiados intentos con este código. Pide otro con «Enviar otro código».", 429);
    }
    const stored = row.verifyCodeHash;
    const matches = labelledHmacCandidates("whatsapp-verify", codeHashInput(user.id, row.address, code)).some((h) => safeEqual(h, stored));
    if (!matches) {
      const left = WHATSAPP_CODE_ATTEMPTS - row.verifyAttempts - 1;
      if (left <= 0) {
        await db.userChannel.updateMany({ where: { id: row.id, verifyCodeHash: stored }, data: { verifyCodeHash: null, verifyExpiresAt: null } });
        throw new AppError("El código no es correcto y ya no quedan intentos. Pide otro con «Enviar otro código».");
      }
      throw new AppError(left === 1 ? t("El código no es correcto. Te queda 1 intento.") : t("El código no es correcto. Te quedan {n} intentos.", { n: left }));
    }
    const done = await db.userChannel.updateMany({ where: { id: row.id, verifyCodeHash: stored }, data: { verifiedAt: new Date(), verifyCodeHash: null, verifyExpiresAt: null, verifyAttempts: 0 } });
    if (!done.count) throw new AppError("El código ha caducado o ya no vale. Pide otro con «Enviar otro código».");
    describeAction("Confirmó su número de WhatsApp");
    revalidatePath("/settings");
    return { verified: true };
  });
}

/** Mensaje de prueba a uno mismo por un canal conectado. */
export async function testMyChannel(channel: "TELEGRAM" | "WHATSAPP") {
  return runAction({ name: "profile.testChannel", args: [channel] }, async () => {
    const user = await requireUser();
    const ch = channelSchema.parse(channel);
    if (!rateLimit(`messaging:mytest:${user.id}`, 5, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const row = await db.userChannel.findUnique({ where: { userId_channel: { userId: user.id, channel: ch } }, select: { address: true, verifiedAt: true, consentAt: true } });
    if (!row) throw new AppError("Conecta primero este canal.");
    const cfg = await loadMessagingConfig();
    const t = await getT();
    if (ch === "TELEGRAM") {
      if (!cfg.telegram.active) throw new AppError("Los avisos por Telegram no están activados en esta instalación.");
      try {
        await sendTelegramMessage(cfg.telegram.token, row.address, telegramTestText(t));
      } catch (err) {
        throw await apiFailure("No se pudo enviar el mensaje de prueba.", err, [cfg.telegram.token]);
      }
    } else {
      if (!cfg.whatsapp.active) throw new AppError("Los avisos por WhatsApp no están activados en esta instalación.");
      // Solo a un número ya confirmado (para uno pendiente está «Enviar otro código»), y con el tope diario.
      if (!row.verifiedAt || !row.consentAt) throw new AppError("Confirma primero tu número con el código que te llegó por WhatsApp.");
      await reserveWhatsappTest(user.id, row.address);
      await sendTest(cfg.whatsapp, row.address, user.locale);
    }
  });
}
