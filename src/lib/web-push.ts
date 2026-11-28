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
  encryptPushPayload, generateVapidKeys, PUSH_DEVICES_MAX, PUSH_TIMEOUT_MS, PUSH_VAPID_KEY, pushEndpointHost, pushMessageJson, pushOutcome, pushRequestHeaders, pushServiceName, validPushKeys, vapidFromJwk, vapidJwt, vapidSubject,
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
      // Ninguna clave de ENCRYPTION_KEY la abre (se cambió sin la anterior): se crea otra. Las suscripciones están atadas a
      // la clave pública anterior (el servicio push rechazaría la firma nueva), así que se borran todas en la misma
      // transacción: solo el proceso que gana el cambio (la fila sigue con el valor que leyó) las borra.
      const fresh = generateVapidKeys();
      const removed = await db.$transaction(async (tx) => {
        const { count } = await tx.appState.updateMany({ where: { key: PUSH_VAPID_KEY, value: row.value }, data: { value: encryptSecret(JSON.stringify(fresh.privateJwk)) } });
        return count ? (await tx.pushSubscription.deleteMany({})).count : null;
      });
      if (removed !== null) logEvent({ category: "notify", level: "warn", action: "push.vapidReset", label: { k: "Avisos push: no se pudo descifrar la clave de la instalación (¿cambió ENCRYPTION_KEY?) y se ha creado otra; se han quitado los {n} dispositivos suscritos y cada persona tiene que volver a activar los avisos en los suyos", p: { n: removed } }, details: { removed } });
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

/** Olvida la copia en memoria: la próxima vez se lee de la base (las pruebas, y el envío si una suscripción es de otra clave). */
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

/** ¿Son las mismas claves? (para dejar pasar una suscripción de una cuenta a otra solo desde el mismo navegador). */
function sameKeys(enc: string, keys: PushKeys): boolean {
  try {
    const saved = JSON.parse(decryptSecret(enc)) as Partial<PushKeys>;
    return saved.p256dh === keys.p256dh && saved.auth === keys.auth;
  } catch {
    return false;
  }
}

export class PushSubscribeError extends Error {
  constructor(readonly reason: "service" | "keys" | "limit" | "unknown") {
    super(reason);
  }
}

/**
 * Guarda (o renueva) la suscripción de este navegador para `userId`, atada a la sesión `sessionId` (cerrarla la borra) y
 * a la clave VAPID actual. Solo servicios push de la lista cerrada y claves válidas. Si el mismo navegador estaba
 * suscrito con otra cuenta (dos personas en el mismo ordenador), pasa a esta solo con las mismas claves p256dh/auth: con
 * el endpoint de otra persona y claves inventadas no se le puede quitar su dispositivo. Como mucho PUSH_DEVICES_MAX
 * dispositivos por persona.
 */
export async function savePushSubscription(userId: string, sessionId: string, input: { endpoint: unknown; keys: unknown }, userAgent: string): Promise<{ id: string; created: boolean }> {
  const host = pushEndpointHost(input.endpoint);
  if (!host) throw new PushSubscribeError("service");
  const keys = validPushKeys(input.keys);
  if (!keys) throw new PushSubscribeError("keys");
  const endpoint = input.endpoint as string;
  const hash = endpointHash(endpoint);
  const vapid = await vapidKeys();
  const data = { userId, sessionId, vapidPublicKey: vapid.publicKey, endpointEnc: encryptSecret(endpoint), keysEnc: encryptSecret(JSON.stringify(keys)), host, userAgent: userAgent.slice(0, 300) };
  return db.$transaction(async (tx) => {
    const prev = await tx.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { id: true, userId: true, keysEnc: true } });
    if (prev && prev.userId !== userId && !sameKeys(prev.keysEnc, keys)) throw new PushSubscribeError("keys");
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

/**
 * Cambia la suscripción de un dispositivo por otra nueva del mismo navegador (el navegador renovó la suya: evento
 * `pushsubscriptionchange` o resincronización al abrir la app). Solo sustituye una suscripción PROPIA de ESTA sesión:
 * la vieja se reconoce por su huella (`oldHash`) y tiene que ser de `userId` y de `sessionId`; con otra huella, de otra
 * persona o de otra sesión no hace nada (reason «unknown»). La nueva pasa las mismas comprobaciones que savePushSubscription
 * (servicio de la lista cerrada, claves válidas); si ya estaba guardada con otra cuenta, solo pasa con las mismas claves.
 */
export async function renewPushSubscription(userId: string, sessionId: string, oldHash: unknown, input: { endpoint: unknown; keys: unknown }, userAgent: string): Promise<{ id: string }> {
  if (typeof oldHash !== "string" || !/^[0-9a-f]{64}$/.test(oldHash)) throw new PushSubscribeError("unknown");
  const host = pushEndpointHost(input.endpoint);
  if (!host) throw new PushSubscribeError("service");
  const keys = validPushKeys(input.keys);
  if (!keys) throw new PushSubscribeError("keys");
  const endpoint = input.endpoint as string;
  const hash = endpointHash(endpoint);
  const vapid = await vapidKeys();
  const data = { vapidPublicKey: vapid.publicKey, endpointEnc: encryptSecret(endpoint), keysEnc: encryptSecret(JSON.stringify(keys)), host, userAgent: userAgent.slice(0, 300), endpointHash: hash };
  return db.$transaction(async (tx) => {
    const old = await tx.pushSubscription.findFirst({ where: { endpointHash: oldHash, userId, sessionId }, select: { id: true } });
    if (!old) throw new PushSubscribeError("unknown");
    const other = hash === oldHash ? null : await tx.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { id: true, userId: true, keysEnc: true } });
    if (other && other.userId !== userId && !sameKeys(other.keysEnc, keys)) throw new PushSubscribeError("keys");
    if (other) await tx.pushSubscription.delete({ where: { id: other.id } });
    await tx.pushSubscription.update({ where: { id: old.id }, data });
    return { id: old.id };
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

const SUBJECT_TTL_MS = 5 * 60_000;
/** JWT VAPID por servicio (aud), reutilizado unas horas (caduca a las 12 h): una firma por servicio, no por aviso. */
const JWT_REUSE_SEC = 6 * 60 * 60;
type PushCache = { subject: { value: string; at: number } | null; jwts: Map<string, { jwt: string; until: number }> };
const cache = (): PushCache => ((globalThis as unknown as Record<string, PushCache | undefined>).__pizarroPushCache ??= { subject: null, jwts: new Map() });

/** Contacto VAPID (email público de contacto o la dirección de la app), guardado 5 minutos en memoria. */
async function subject(): Promise<string> {
  const c = cache();
  if (c.subject && Date.now() - c.subject.at < SUBJECT_TTL_MS) return c.subject.value;
  const legal = await getLegalSettings().catch(() => ({ email: "" }));
  c.subject = { value: vapidSubject(legal.email, appUrl()), at: Date.now() };
  return c.subject.value;
}

function cachedJwt(endpoint: string, sub: string, vapid: VapidKeys): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const key = `${new URL(endpoint).origin}|${sub}|${vapid.publicKey}`;
  const hit = cache().jwts.get(key);
  if (hit && hit.until > nowSec) return hit.jwt;
  const jwt = vapidJwt(endpoint, sub, vapid, nowSec);
  const jwts = cache().jwts;
  if (jwts.size > 50) jwts.clear();
  jwts.set(key, { jwt, until: nowSec + JWT_REUSE_SEC });
  return jwt;
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
      headers: pushRequestHeaders(endpoint, sub, vapid, { jwt: cachedJwt(endpoint, sub, vapid) }),
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
 * Envía un aviso push a todos los dispositivos de una persona a la vez (como mucho PUSH_TIMEOUT_MS en total). Se borran
 * las suscripciones caducadas (404/410), ilegibles, de una sesión ya caducada o de otra clave VAPID. Cada resultado queda
 * en Logs con el servicio (Google, Apple…), nunca con el endpoint.
 */
export async function sendPushToUser(
  user: { id: string; name: string },
  message: PushMessage,
  log: { projectId?: string; details?: Record<string, unknown>; test?: boolean; /** Solo a ese dispositivo (huella del endpoint): «Probar» prueba el de quien pulsa. */ onlyHash?: string } = {},
): Promise<PushResult> {
  const subs = await db.pushSubscription.findMany({ where: { userId: user.id, ...(log.onlyHash ? { endpointHash: log.onlyHash } : {}) }, select: { id: true, host: true, endpointEnc: true, keysEnc: true, vapidPublicKey: true, session: { select: { expiresAt: true } } } });
  const out: PushResult = { sent: 0, failed: 0, expired: 0, errors: [] };
  if (!subs.length) return out;
  const [first, sub] = await Promise.all([vapidKeys(), subject()]);
  let vapid = first;
  // Otra clave: puede que otro proceso la haya cambiado y esta copia en memoria sea la vieja; se relee una vez antes de
  // dar por buenas las diferencias (si no, se borrarían las suscripciones nuevas).
  if (subs.some((s) => s.vapidPublicKey !== vapid.publicKey)) {
    forgetVapidKeys();
    vapid = await vapidKeys();
  }
  const base = { category: "notify", userId: user.id, userName: user.name, projectId: log.projectId };
  const now = Date.now();
  const one = async (s: (typeof subs)[number]) => {
    const details = { ...log.details, subscriptionId: s.id, service: s.host, test: log.test || undefined };
    let endpoint = "";
    let keys: PushKeys | null = null;
    try {
      endpoint = decryptSecret(s.endpointEnc);
      keys = validPushKeys(JSON.parse(decryptSecret(s.keysEnc)));
    } catch {
      keys = null;
    }
    const t0 = performance.now();
    const stale = s.session.expiresAt.getTime() <= now ? "session" : s.vapidPublicKey !== vapid.publicKey ? "vapid" : !keys ? "unreadable" : null;
    const r = stale || !keys ? { outcome: "expired" as const, detail: stale ?? "unreadable" } : await postPush(endpoint, keys, message, vapid, sub);
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
  };
  // Todos a la vez: un servicio lento no retrasa a los demás dispositivos. Un fallo de la base cuenta como fallo.
  for (const r of await Promise.allSettled(subs.map(one))) {
    if (r.status === "rejected") {
      out.failed++;
      out.errors.push("error");
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
