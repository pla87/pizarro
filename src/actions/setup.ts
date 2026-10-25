"use server";

import { headers } from "next/headers";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { emailEnabled, sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { checkSetupCode, completeSetup, isSetupPending } from "@/lib/setup";
import { translate, type Locale } from "@/i18n/core";

// Los errores de estas acciones salen en el idioma elegido en el asistente (todavía no hay usuario con idioma).
const lang = (l: unknown): Locale => (l === "en" ? "en" : "es");

const WINDOW = 15 * 60_000;

/** Frena los intentos de adivinar el código: por IP y en total (solo cuentan los fallidos). */
async function guardCode(code: string, l: Locale): Promise<string> {
  if (!(await isSetupPending(db))) throw new AppError(translate(l, "La instalación ya está configurada."), 404);
  const ip = clientIp(await headers());
  const ipKey = `setup:fail:ip:${ip}`;
  const allKey = "setup:fail:all";
  // Coste 0: solo consulta si ya está bloqueado, sin sumar.
  if (!rateLimit(ipKey, 8, WINDOW, 0) || !rateLimit(allKey, 30, WINDOW, 0)) throw new AppError(translate(l, "Demasiados intentos. Espera unos minutos."), 429);
  if (!(await checkSetupCode(db, code))) {
    rateLimit(ipKey, 8, WINDOW);
    rateLimit(allKey, 30, WINDOW);
    logEvent({ level: "warn", category: "auth", action: "setup.codeFailed", message: "Código del asistente de instalación incorrecto", path: "/setup", ip });
    throw new AppError(translate(l, "El código no es correcto o ha caducado."), 403);
  }
  return ip;
}

/** Paso 1: comprueba el código del log (o SETUP_TOKEN). */
export async function verifySetupCodeAction(code: string, language: string) {
  return runAction(async () => {
    await guardCode(String(code ?? ""), lang(language));
  });
}

/** Paso 4: email de prueba a la dirección del administrador (solo con SMTP configurado). */
export async function sendSetupTestEmail(code: string, language: string, to: string) {
  return runAction(async () => {
    const l = lang(language);
    const ip = await guardCode(String(code ?? ""), l);
    if (!emailEnabled()) throw new AppError(translate(l, "El envío de emails no está configurado."));
    if (!rateLimit(`setup:mail:${ip}`, 5, WINDOW)) throw new AppError(translate(l, "Demasiados intentos. Espera unos minutos."), 429);
    const address = String(to ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) || address.length > 200) throw new AppError(translate(l, "El email no es válido."));
    try {
      await sendMail({
        to: address,
        subject: translate(l, "Prueba de email de Pizarro"),
        text: translate(l, "Si lees esto, el envío de emails de Pizarro funciona correctamente."),
      });
    } catch (err) {
      console.error("[setup] No se pudo enviar el email de prueba:", err);
      throw new AppError(translate(l, "No se pudo enviar el email de prueba. Revisa las variables SMTP_* y los logs del contenedor."));
    }
  });
}

export interface SetupForm {
  code: string;
  orgName: string;
  language: string;
  timeZone: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

/** Paso final: crea la instalación y el primer administrador. Tras esto /setup deja de existir. */
export async function completeSetupAction(form: SetupForm) {
  return runAction(async () => {
    const l = lang(form?.language);
    const ip = await guardCode(String(form?.code ?? ""), l);
    try {
      await completeSetup(db, {
        code: String(form.code),
        orgName: String(form.orgName ?? ""),
        locale: l,
        timeZone: String(form.timeZone ?? ""),
        adminName: String(form.adminName ?? ""),
        adminEmail: String(form.adminEmail ?? ""),
        adminPassword: String(form.adminPassword ?? ""),
      });
    } catch (err) {
      // Los mensajes de validación salen en el idioma elegido.
      if (err instanceof AppError) throw new AppError(translate(l, err.message), err.status, err.code);
      throw err;
    }
    logEvent({ category: "auth", action: "setup.completed", message: "Instalación configurada con el asistente de primer arranque", path: "/setup", ip });
  });
}
