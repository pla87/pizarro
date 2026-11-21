import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { deviceIdHashes, hashDeviceId } from "./auth-token-core";
import { cookieSecure } from "./session-config";

// Dispositivos conocidos: una cookie larga y aleatoria (pz_device) identifica el navegador; en la BD solo
// se guarda su hash. Sirve para avisar de inicios de sesión desde un dispositivo nuevo, para dar margen extra de intentos
// de acceso desde un dispositivo ya conocido de la cuenta y, con «Recordar este dispositivo», para no pedir el segundo paso.

export const DEVICE_COOKIE = "pz_device";
export const TRUST_DEVICE_DAYS = 14;
const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Anota el dispositivo de este inicio de sesión. Devuelve `alert: true` si es nuevo y la cuenta ya tenía
 * otros dispositivos (el primer acceso de una cuenta no avisa).
 *
 * La cookie que trae el navegador solo se adopta si ya es un dispositivo conocido de ESTA cuenta. Si no, se genera
 * otra y se sobrescribe: quien controle otro subdominio o una conexión sin HTTPS podría plantar un valor que conoce
 * y, tras el «Recordar este dispositivo» de la víctima, entrar con su contraseña sin el segundo paso.
 */
export async function registerDevice(userId: string, opts: { trustDays?: number } = {}): Promise<{ alert: boolean }> {
  const store = await cookies();
  const trustedUntil = opts.trustDays ? new Date(Date.now() + opts.trustDays * 86_400_000) : undefined;
  const sent = store.get(DEVICE_COOKIE)?.value;
  const known = sent && validDeviceId(sent)
    ? await db.knownDevice.findFirst({ where: { userId, deviceHash: { in: deviceIdHashes(sent) } }, select: { id: true } })
    : null;
  const deviceId = known && sent ? sent : randomBytes(32).toString("base64url");
  // Se renueva en cada acceso para que un dispositivo habitual no caduque.
  store.set(DEVICE_COOKIE, deviceId, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: DEVICE_MAX_AGE_SECONDS });

  const deviceHash = hashDeviceId(deviceId);
  if (known) {
    // Si se conocía con la clave anterior (TOKEN_SECRET_PREVIOUS), se pasa a la actual. No se avisa.
    await db.knownDevice.update({ where: { id: known.id }, data: { deviceHash, lastSeenAt: new Date(), ...(trustedUntil ? { trustedUntil } : {}) } }).catch(() => {});
    return { alert: false };
  }
  const others = await db.knownDevice.count({ where: { userId } });
  await db.knownDevice.create({ data: { userId, deviceHash, trustedUntil } });
  return { alert: others > 0 };
}

const validDeviceId = (deviceId: string) => deviceId.length >= 20 && deviceId.length <= 100;

/** La cookie de dispositivo de este navegador, si tiene una forma válida. */
async function deviceCookie(): Promise<string | null> {
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
  return deviceId && validDeviceId(deviceId) ? deviceId : null;
}

/**
 * ¿Este navegador es un dispositivo conocido de la cuenta (ya se ha entrado en ella desde aquí, con o sin «Recordar»)?
 * Da el margen extra de intentos de acceso (LOGIN_ACCOUNT_LIMIT_TRUSTED): un tercero sin la cookie no puede gastarlo.
 */
export async function isKnownDevice(userId: string): Promise<boolean> {
  const deviceId = await deviceCookie();
  if (!deviceId) return false;
  return (await db.knownDevice.count({ where: { userId, deviceHash: { in: deviceIdHashes(deviceId) } } })) > 0;
}

/** «Recordar este dispositivo»: ¿este navegador está marcado como de confianza para esta cuenta (no se pide el segundo paso)? */
export async function isTrustedDevice(userId: string): Promise<boolean> {
  const deviceId = await deviceCookie();
  if (!deviceId) return false;
  return (await db.knownDevice.count({ where: { userId, deviceHash: { in: deviceIdHashes(deviceId) }, trustedUntil: { gt: new Date() } } })) > 0;
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
