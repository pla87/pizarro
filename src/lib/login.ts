import "server-only";
import { headers } from "next/headers";
import { sendNewLoginMail } from "./auth-mail";
import { registerDevice, TRUST_DEVICE_DAYS } from "./devices";
import { logEvent } from "./log";
import { emailEnabled, sendMailInBackground } from "./mail";
import { clientIp } from "./request";
import { createSession } from "./session";
import { deviceLabel } from "./user-agent";
import { makeT, toLocale } from "../i18n/core";

export interface LoginUser {
  id: string;
  name: string;
  email: string;
  locale: string;
  mustChangePassword: boolean;
}

/**
 * Último paso de TODOS los accesos (contraseña, contraseña + segundo paso, Google): abre la sesión, anota el
 * dispositivo (con aviso por email si es nuevo) y deja constancia en el registro. Es el único sitio que
 * llama a createSession para un acceso nuevo: hasta aquí getCurrentUser() devuelve null.
 * Quien llama redirige después.
 */
export async function completeLogin(
  user: LoginUser,
  how: { method: "password" | "google" | "password+2fa"; rememberDevice?: boolean; path: string },
): Promise<void> {
  // Con Google no se pide contraseña, así que tampoco se obliga a cambiarla; la marca queda como estaba para los accesos con contraseña.
  await createSession(user.id, { mustChangePassword: how.method === "google" ? false : user.mustChangePassword });
  const ip = clientIp(await headers());
  const device = await registerDevice(user.id, how.rememberDevice ? { trustDays: TRUST_DEVICE_DAYS } : {});
  if (device.alert && emailEnabled()) {
    const ua = (await headers()).get("user-agent");
    sendMailInBackground("aviso de nuevo inicio de sesión", () =>
      sendNewLoginMail(user, { when: new Date(), device: deviceLabel(ua, makeT(toLocale(user.locale))), ip: ip === "unknown" ? null : ip }),
    );
  }
  logEvent({
    category: "auth", action: "auth.login",
    message: `${user.name} ha iniciado sesión${how.method === "google" ? " con Google" : how.method === "password+2fa" ? " (con verificación en dos pasos)" : ""}`,
    userId: user.id, userName: user.name, path: how.path, ip, details: { email: user.email, method: how.method },
  });
}
