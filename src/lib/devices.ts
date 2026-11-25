import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { deviceIdHashes, hashDeviceId } from "./auth-token-core";
import { LEGACY_DEVICE_COOKIE, cookieSecure, deviceCookieName } from "./session-config";

// Dispositivos conocidos: una cookie larga y aleatoria identifica el navegador ante cada cuenta; en la BD solo se guarda su
// hash (KnownDevice, por cuenta). Sirve para avisar de inicios de sesión desde un dispositivo nuevo, para dar margen extra de
// intentos de acceso desde un dispositivo ya conocido de la cuenta y, con «Recordar este dispositivo», para no pedir el
// segundo paso.
//
// Varias cuentas en el mismo navegador: la cookie guarda una marca por cuenta (hasta MAX_DEVICE_ENTRIES, separadas por
// puntos, la última usada primero). Antes había una sola y cada acceso de otra persona la sustituía: la primera perdía su
// «Recordar» y recibía el aviso de nuevo inicio de sesión al volver. Cada marca es un valor aleatorio de 256 bits que solo
// vale para la cuenta cuya fila KnownDevice tiene su hash: no hace falta firmarla (no se puede adivinar ni derivar de nada,
// y no dice de quién es) y la de una cuenta no sirve para otra, porque cada búsqueda va filtrada por la cuenta.
// Una cookie de antes, con una sola marca, se lee igual: es una lista de una.

const DEVICE_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, path: "/" };
export const TRUST_DEVICE_DAYS = 14;
const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Cuentas recordadas a la vez en un navegador: con una más, se olvida la que lleva más tiempo sin entrar desde él. */
const MAX_DEVICE_ENTRIES = 8;
const DEVICE_ID = /^[A-Za-z0-9_-]{20,100}$/;

/** Marcas de la cookie, en su orden, sin repetidas ni mal formadas, como mucho MAX_DEVICE_ENTRIES. */
function parseDeviceIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids: string[] = [];
  for (const id of raw.slice(0, MAX_DEVICE_ENTRIES * 101).split(".")) {
    if (DEVICE_ID.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === MAX_DEVICE_ENTRIES) break;
  }
  return ids;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Marcas que trae el navegador. Con HTTPS la cookie es __Host-pz_device; mientras no la tenga se lee la de antes
 * (pz_device), que cualquier subdominio podría haber plantado: da igual, porque una marca solo se adopta si ya es de esa
 * cuenta (ver registerDevice).
 */
function sentDeviceIds(store: CookieStore): string[] {
  const name = deviceCookieName();
  const current = store.get(name)?.value;
  if (current !== undefined || name === LEGACY_DEVICE_COOKIE) return parseDeviceIds(current);
  return parseDeviceIds(store.get(LEGACY_DEVICE_COOKIE)?.value);
}

/** Filas de la cuenta que corresponden a alguna de las marcas (con la clave actual o, durante la rotación, la anterior). */
function rowsForIds(userId: string, ids: string[], extra: { trustedUntil?: { gt: Date } } = {}) {
  return db.knownDevice.findMany({ where: { userId, deviceHash: { in: ids.flatMap(deviceIdHashes) }, ...extra }, select: { id: true, deviceHash: true } });
}

/**
 * Anota el dispositivo de este inicio de sesión. Devuelve `alert: true` si es nuevo y la cuenta ya tenía
 * otros dispositivos (el primer acceso de una cuenta no avisa).
 *
 * Una marca que trae el navegador solo se adopta si ya es un dispositivo conocido de ESTA cuenta. Si no, se genera
 * otra: quien controle otro subdominio o una conexión sin HTTPS podría plantar un valor que conoce y, tras el «Recordar
 * este dispositivo» de la víctima, entrar con su contraseña sin el segundo paso. Las marcas de las demás cuentas se
 * conservan detrás (son de otras personas que usan este navegador).
 */
export async function registerDevice(userId: string, opts: { trustDays?: number } = {}): Promise<{ alert: boolean }> {
  const store = await cookies();
  const trustedUntil = opts.trustDays ? new Date(Date.now() + opts.trustDays * 86_400_000) : undefined;
  const sent = sentDeviceIds(store);
  const rows = sent.length ? await rowsForIds(userId, sent) : [];
  const isMine = (id: string) => deviceIdHashes(id).some((h) => rows.some((r) => r.deviceHash === h));
  // La primera de la cuenta (la usada más recientemente); otras de la misma cuenta, si las hubiera, sobran.
  const mine = sent.find(isMine);
  const known = mine ? rows.find((r) => deviceIdHashes(mine).includes(r.deviceHash)) : undefined;
  const deviceId = mine ?? randomBytes(32).toString("base64url");
  const others = sent.filter((id) => !isMine(id));
  // Se renueva en cada acceso para que un dispositivo habitual no caduque; la cuenta que entra pasa a la cabeza.
  const name = deviceCookieName();
  store.set(name, [deviceId, ...others].slice(0, MAX_DEVICE_ENTRIES).join("."), { ...DEVICE_COOKIE_OPTIONS, secure: cookieSecure(), maxAge: DEVICE_MAX_AGE_SECONDS });
  if (name !== LEGACY_DEVICE_COOKIE && store.get(LEGACY_DEVICE_COOKIE)) {
    store.set(LEGACY_DEVICE_COOKIE, "", { ...DEVICE_COOKIE_OPTIONS, secure: cookieSecure(), maxAge: 0 });
  }

  const deviceHash = hashDeviceId(deviceId);
  if (known) {
    // Si se conocía con la clave anterior (TOKEN_SECRET_PREVIOUS), se pasa a la actual. No se avisa.
    await db.knownDevice.update({ where: { id: known.id }, data: { deviceHash, lastSeenAt: new Date(), ...(trustedUntil ? { trustedUntil } : {}) } }).catch(() => {});
    return { alert: false };
  }
  const count = await db.knownDevice.count({ where: { userId } });
  await db.knownDevice.create({ data: { userId, deviceHash, trustedUntil } });
  return { alert: count > 0 };
}

/**
 * ¿Este navegador es un dispositivo conocido de la cuenta (ya se ha entrado en ella desde aquí, con o sin «Recordar»)?
 * Da el margen extra de intentos de acceso (LOGIN_ACCOUNT_LIMIT_TRUSTED): un tercero sin la cookie no puede gastarlo.
 */
export async function isKnownDevice(userId: string): Promise<boolean> {
  return (await knownDeviceCheck())(userId);
}

/**
 * Lo mismo que isKnownDevice, en dos tiempos: la cookie se lee ahora (durante la petición) y la cuenta se comprueba
 * después, con la función que devuelve. Para un envío en segundo plano (sendMailInBackground), que corre cuando la
 * respuesta ya ha salido y ya no hay cookies: así la respuesta tampoco tarda más según exista o no la cuenta.
 */
export async function knownDeviceCheck(): Promise<(userId: string) => Promise<boolean>> {
  const ids = sentDeviceIds(await cookies());
  return async (userId) => ids.length > 0 && (await rowsForIds(userId, ids)).length > 0;
}

/** «Recordar este dispositivo»: ¿este navegador está marcado como de confianza para esta cuenta (no se pide el segundo paso)? */
export async function isTrustedDevice(userId: string): Promise<boolean> {
  const ids = sentDeviceIds(await cookies());
  return ids.length > 0 && (await rowsForIds(userId, ids, { trustedUntil: { gt: new Date() } })).length > 0;
}

/**
 * «Cerrar las demás sesiones»: quita la confianza («Recordar este dispositivo») a todos los dispositivos de la cuenta menos
 * este navegador; si no, una sesión intrusa cerrada podría volver a entrar con la contraseña sin el segundo paso.
 */
export async function revokeOtherTrustedDevices(userId: string): Promise<void> {
  const ids = sentDeviceIds(await cookies());
  const mine = ids.length ? (await rowsForIds(userId, ids)).map((r) => r.id) : [];
  await db.knownDevice.updateMany({ where: { userId, trustedUntil: { not: null }, ...(mine.length ? { id: { notIn: mine } } : {}) }, data: { trustedUntil: null } });
}

/** Quita la confianza de todos los dispositivos de la cuenta (al cambiar de método, restablecer o cambiar la contraseña). */
export async function revokeTrustedDevices(userId: string): Promise<void> {
  await db.knownDevice.updateMany({ where: { userId, trustedUntil: { not: null } }, data: { trustedUntil: null } });
}

/** Borra los dispositivos sin actividad desde hace más de lo que dura su cookie. */
export async function purgeOldDevices(now: Date = new Date()): Promise<number> {
  const { count } = await db.knownDevice.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - DEVICE_MAX_AGE_SECONDS * 1000) } } });
  return count;
}
