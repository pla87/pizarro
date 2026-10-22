import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { hashDeviceId } from "./auth-token-core";
import { cookieSecure } from "./session-config";

// Dispositivos conocidos: una cookie larga y aleatoria (pz_device) identifica el navegador; en la BD solo
// se guarda su hash. Sirve únicamente para avisar de inicios de sesión desde un dispositivo nuevo.

export const DEVICE_COOKIE = "pz_device";
const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Anota el dispositivo de este inicio de sesión. Devuelve `alert: true` si es nuevo y la cuenta ya tenía
 * otros dispositivos (el primer acceso de una cuenta no avisa).
 */
export async function registerDevice(userId: string): Promise<{ alert: boolean }> {
  const store = await cookies();
  let deviceId = store.get(DEVICE_COOKIE)?.value;
  if (!deviceId || deviceId.length < 20 || deviceId.length > 100) deviceId = randomBytes(32).toString("base64url");
  // Se renueva en cada acceso para que un dispositivo habitual no caduque.
  store.set(DEVICE_COOKIE, deviceId, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: DEVICE_MAX_AGE_SECONDS });

  const deviceHash = hashDeviceId(deviceId);
  const known = await db.knownDevice.updateMany({ where: { userId, deviceHash }, data: { lastSeenAt: new Date() } });
  if (known.count > 0) return { alert: false };
  const others = await db.knownDevice.count({ where: { userId } });
  try {
    await db.knownDevice.create({ data: { userId, deviceHash } });
  } catch {
    // Dos inicios de sesión simultáneos desde el mismo navegador: el otro ya lo ha registrado.
    return { alert: false };
  }
  return { alert: others > 0 };
}

/** Borra los dispositivos sin actividad desde hace más de lo que dura su cookie. */
export async function purgeOldDevices(now: Date = new Date()): Promise<number> {
  const { count } = await db.knownDevice.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - DEVICE_MAX_AGE_SECONDS * 1000) } } });
  return count;
}
