import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./keyring";
import { logEvent, logText } from "./log";
import { appUrl } from "./mail";
import { getLegalSettings } from "./legal";
import { getAppIcon } from "./app-icon";
import { appIconUrl } from "./app-icon-core";
import { channelWants, type ChannelPrefs } from "./messaging-core";
import type { NotificationKind } from "./notification-text";
import { deviceLabel } from "./user-agent";
import type { T } from "../i18n/core";
import {
  encryptPushPayload, generateVapidKeys, PUSH_DEVICES_MAX, PUSH_TIMEOUT_MS, PUSH_VAPID_KEY, pushEndpointHost, pushMessageJson, pushOutcome, pushRequestHeaders, pushServiceName, validPushKeys, vapidFromJwk, vapidSubject,
  type PushKeys, type PushMessage, type VapidKeys,
} from "./web-push-core";

// Avisos push del navegador (Mi perfil → Avisos → «Avisos en este dispositivo»): claves VAPID de la instalación,
// dispositivos suscritos (PushSubscription, con el endpoint y las claves cifrados) y el envío a los servicios push.
// El endpoint es un secreto (con él se puede escribir a ese navegador): nunca va a Logs, exportaciones ni el tablero.

// --- Claves VAPID ---

const GLOBAL = "__pizarroVapid";
type VapidStore = { keys: VapidKeys | null; loading: Promise<VapidKeys> | null };
const store = (): VapidStore => ((globalThis as unknown as Record<string, VapidStore | undefined>)[GLOBAL] ??= { keys: null, loading: null });

async function readOrCreateVapid(): Promise<VapidKeys> {
  const row = await db.appState.findUnique({ where: { key: PUSH_VAPID_KEY }, select: { value: true } });
  if (row) {
    try {
      return vapidFromJwk(JSON.parse(decryptSecret(row.value)));
    } catch {
      // Ninguna clave de ENCRYPTION_KEY la abre (se cambió sin la anterior): se crea otra. Los dispositivos suscritos con
      // la anterior dejan de recibir avisos (sus claves tampoco se pueden leer y se borran al intentar enviarles).
      const fresh = generateVapidKeys();
      const { count } = await db.appState.updateMany({ where: { key: PUSH_VAPID_KEY, value: row.value }, data: { value: encryptSecret(JSON.stringify(fresh.privateJwk)) } });
      if (count) logEvent({ category: "notify", level: "warn", action: "push.vapidReset", label: { k: "Avisos push: no se pudo descifrar la clave de la instalación (¿cambió ENCRYPTION_KEY?) y se ha creado otra; cada persona tiene que volver a activar los avisos en sus dispositivos" } });
      return readOrCreateVapid();
    }
  }
  // Primera vez: se crea el par. Dos procesos a la vez: se queda el primero que lo guarda y los dos leen ese.
  const keys = generateVapidKeys();
  await db.appState.createMany({ data: [{ key: PUSH_VAPID_KEY, value: encryptSecret(JSON.stringify(keys.privateJwk)) }], skipDuplicates: true });
  const saved = await db.appState.findUniqueOrThrow({ where: { key: PUSH_VAPID_KEY }, select: { value: true } });
  return vapidFromJwk(JSON.parse(decryptSecret(saved.value)));
}

/** El par VAPID de la instalación (se crea solo la primera vez; en memoria después). */
export async function vapidKeys(): Promise<VapidKeys> {
  const s = store();
  if (s.keys) return s.keys;
  s.loading ??= readOrCreateVapid()
    .then((k) => (s.keys = k))
    .finally(() => {
      s.loading = null;
    });
  return s.loading;
}

/** Olvida la copia en memoria (pruebas y rotación). */
export function forgetVapidKeys(): void {
  store().keys = null;
}

// --- Dispositivos ---

export const endpointHash = (endpoint: string): string => createHash("sha256").update(endpoint).digest("hex");

/** Preferencias de los avisos push guardadas en User, con la forma de las de Telegram y WhatsApp (channelWants). */
const pushPrefsOf = (u: { pushNotifyMention: boolean; pushNotifyAssigned: boolean; pushNotifyDue: boolean; pushNotifyComment: boolean }): ChannelPrefs => ({
  notifyMention: u.pushNotifyMention, notifyAssigned: u.pushNotifyAssigned, notifyDue: u.pushNotifyDue, notifyComment: u.pushNotifyComment,
});

/** Lo que hace falta de User para decidir si sale un aviso push (en las consultas de notify.ts). */
export const PUSH_USER_SELECT = { pushNotifyMention: true, pushNotifyAssigned: true, pushNotifyDue: true, pushNotifyComment: true, _count: { select: { pushSubscriptions: true } } } as const;
type PushUser = Parameters<typeof pushPrefsOf>[0] & { _count: { pushSubscriptions: number } };

/** ¿Sale este aviso por push? Con algún dispositivo suscrito y el tipo marcado en sus preferencias. */
export const pushWanted = (type: NotificationKind, u: PushUser): boolean => u._count.pushSubscriptions > 0 && channelWants(type, pushPrefsOf(u));

export class PushSubscribeError extends Error {
  constructor(readonly reason: "service" | "keys" | "limit") {
    super(reason);
  }
}

/**
 * Guarda (o renueva) la suscripción de este navegador para `userId`. Solo servicios push de la lista cerrada y claves
 * válidas. Si el mismo navegador estaba suscrito con otra cuenta (dos personas en el mismo ordenador), pasa a esta.
 * Como mucho PUSH_DEVICES_MAX dispositivos por persona.
 */
export async function savePushSubscription(userId: string, input: { endpoint: unknown; keys: unknown }, userAgent: string): Promise<{ id: string; created: boolean }> {
  const host = pushEndpointHost(input.endpoint);
  if (!host) throw new PushSubscribeError("service");
  const keys = validPushKeys(input.keys);
  if (!keys) throw new PushSubscribeError("keys");
  const endpoint = input.endpoint as string;
  const hash = endpointHash(endpoint);
  const data = { userId, endpointEnc: encryptSecret(endpoint), keysEnc: encryptSecret(JSON.stringify(keys)), host, userAgent: userAgent.slice(0, 300) };
  return db.$transaction(async (tx) => {
    const prev = await tx.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { id: true, userId: true } });
    if (prev?.userId === userId) {
      await tx.pushSubscription.update({ where: { id: prev.id }, data });
      return { id: prev.id, created: false };
    }
    const count = await tx.pushSubscription.count({ where: { userId } });
    if (count >= PUSH_DEVICES_MAX) throw new PushSubscribeError("limit");
    if (prev) await tx.pushSubscription.delete({ where: { id: prev.id } });
    const row = await tx.pushSubscription.create({ data: { ...data, endpointHash: hash }, select: { id: true } });
    return { id: row.id, created: true };
  });
}

/** Dispositivos de una persona para Mi perfil (sin endpoint ni claves; `hash` deja a la página reconocer el suyo). */
async function myPushDevices(userId: string) {
  const rows = await db.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, endpointHash: true, host: true, userAgent: true, createdAt: true, lastSentAt: true } });
  return rows.map((r) => ({ id: r.id, hash: r.endpointHash, host: r.host, userAgent: r.userAgent, createdAt: r.createdAt.toISOString(), lastSentAt: r.lastSentAt?.toISOString() ?? null }));
}

// --- Envío ---

/** Icono de la notificación: el de la app instalada (con el color elegido en Administración). */
export async function pushIcon(): Promise<string> {
  return appIconUrl(await getAppIcon(), "icon-192.png");
}

async function subject(): Promise<string> {
  const legal = await getLegalSettings().catch(() => ({ email: "" }));
  return vapidSubject(legal.email, appUrl());
}

/**
 * Un POST al servicio push: el host se vuelve a comprobar (lista cerrada), sin seguir redirecciones y con tiempo máximo.
 * Devuelve el resultado y, si falló, el código HTTP o el motivo (sin el endpoint).
 */
async function postPush(endpoint: string, keys: PushKeys, message: PushMessage, vapid: VapidKeys, sub: string): Promise<{ outcome: "sent" | "expired" | "failed"; detail: string }> {
  if (!pushEndpointHost(endpoint)) return { outcome: "expired", detail: "host" };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: pushRequestHeaders(endpoint, sub, vapid),
      body: new Uint8Array(encryptPushPayload(pushMessageJson(message), keys)),
      redirect: "error",
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    return { outcome: pushOutcome(res.status), detail: `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { outcome: "failed", detail: e.name === "TimeoutError" ? "timeout" : (e.cause?.code ?? e.name ?? "error") };
  }
}

interface PushResult {
  sent: number;
  failed: number;
  expired: number;
  /** Motivos de los fallos («HTTP 500», «timeout»…), para Notification.deliveryError. */
  errors: string[];
}

/**
 * Envía un aviso push a los dispositivos de una persona (todos o solo `onlyIds`). Las suscripciones caducadas (404/410)
 * o ilegibles se borran. Cada resultado queda en Logs con el servicio (Google, Apple…), nunca con el endpoint.
 */
export async function sendPushToUser(
  user: { id: string; name: string },
  message: PushMessage,
  log: { projectId?: string; details?: Record<string, unknown>; test?: boolean } = {},
): Promise<PushResult> {
  const subs = await db.pushSubscription.findMany({ where: { userId: user.id }, select: { id: true, host: true, endpointEnc: true, keysEnc: true } });
  const out: PushResult = { sent: 0, failed: 0, expired: 0, errors: [] };
  if (!subs.length) return out;
  const [vapid, sub] = await Promise.all([vapidKeys(), subject()]);
  const base = { category: "notify", userId: user.id, userName: user.name, projectId: log.projectId };
  for (const s of subs) {
    const details = { ...log.details, subscriptionId: s.id, service: s.host, test: log.test || undefined };
    let endpoint: string;
    let keys: PushKeys | null;
    try {
      endpoint = decryptSecret(s.endpointEnc);
      keys = validPushKeys(JSON.parse(decryptSecret(s.keysEnc)));
    } catch {
      keys = null;
      endpoint = "";
    }
    const t0 = performance.now();
    const r = keys ? await postPush(endpoint, keys, message, vapid, sub) : { outcome: "expired" as const, detail: "unreadable" };
    const durationMs = performance.now() - t0;
    if (r.outcome === "sent") {
      out.sent++;
      await db.pushSubscription.updateMany({ where: { id: s.id }, data: { lastSentAt: new Date() } });
      logEvent({ ...base, action: "notify.push", label: { k: "Aviso push enviado a {name} ({service})", p: { name: user.name, service: s.host } }, durationMs, details });
    } else if (r.outcome === "expired") {
      out.expired++;
      await db.pushSubscription.deleteMany({ where: { id: s.id } });
      logEvent({ ...base, action: "notify.pushExpired", label: { k: "Avisos push: el dispositivo de {name} ({service}) ya no está suscrito y se ha quitado", p: { name: user.name, service: s.host } }, durationMs, details: { ...details, reason: r.detail } });
    } else {
      out.failed++;
      out.errors.push(r.detail);
      logEvent({ ...base, level: "error", action: "notify.pushFailed", label: { k: "Fallo al enviar el aviso push a {name} ({service}): {error}", p: { name: user.name, service: s.host, error: logText(r.detail) } }, durationMs, details });
    }
  }
  return out;
}

/** Lo que enseña Mi perfil → Avisos: la clave pública VAPID (applicationServerKey), las preferencias y los dispositivos. */
export async function pushView(userId: string, t: T) {
  const [keys, devices, row] = await Promise.all([
    vapidKeys(),
    myPushDevices(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { pushNotifyMention: true, pushNotifyAssigned: true, pushNotifyDue: true, pushNotifyComment: true } }),
  ]);
  return {
    publicKey: keys.publicKey,
    maxDevices: PUSH_DEVICES_MAX,
    prefs: pushPrefsOf(row),
    devices: devices.map((d) => ({ id: d.id, hash: d.hash, label: deviceLabel(d.userAgent, t), service: pushServiceName(d.host), createdAt: d.createdAt, lastSentAt: d.lastSentAt })),
  };
}

export type PushView = Awaited<ReturnType<typeof pushView>>;
