"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { loadMailConfig, saveMailSettings as persist } from "@/lib/mail-config";
import { sendMail } from "@/lib/mail";
import { envMailConfig, sanitizeSmtpError, validateMailSettings, type MailSettingsInput } from "@/lib/mail-settings-core";
import { maskEmail } from "@/lib/mask-email";
import { rateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/session";
import { getT } from "@/i18n/server";

// Administración → Ajustes → «Envío de emails». Solo administradores. La contraseña nunca se registra ni se devuelve.
// Los args de la acción NO se pasan a runAction (llevarían la contraseña al registro).

export interface MailSettingsForm extends MailSettingsInput {
  /** Contraseña nueva; vacía o ausente = conservar la guardada. */
  password?: string;
  /** Borrar la contraseña guardada. */
  clearPassword?: boolean;
}

export async function saveMailSettings(form: MailSettingsForm) {
  return runAction({ name: "settings.saveMail" }, async () => {
    await requireAdmin();
    if (envMailConfig()) throw new AppError("El envío de emails está configurado en el servidor (variables SMTP_*) y no se puede cambiar aquí.");
    const checked = validateMailSettings(form);
    if (!checked.ok) throw new AppError(checked.error);
    const password = typeof form.password === "string" ? form.password : "";
    if (password.length > 500 || /[\r\n]/.test(password)) throw new AppError("La contraseña no es válida.");
    const { passwordChange, before, after } = await persist(checked.value, { password, clearPassword: Boolean(form.clearPassword) });
    describeAction("Cambió la configuración del envío de emails", {
      host: after.host || null,
      port: after.port,
      secure: after.secure,
      user: after.user ? maskEmail(after.user) : null,
      from: after.fromAddress ? maskEmail(after.fromAddress) : null,
      enabled: Boolean(after.host),
      was: before.host || null,
      // Nombre sin «password»: el registro tacha cualquier campo así llamado.
      authChange: passwordChange,
    });
    revalidatePath("/admin/settings");
    return { settings: after };
  });
}

/** Envía un email de prueba al propio administrador con la configuración guardada; si falla, devuelve el error del servidor SMTP (sin secretos). */
export async function sendMailTest() {
  return runAction({ name: "settings.sendMailTest" }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`mail:test:${admin.id}`, 5, 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const config = await loadMailConfig();
    const t = await getT();
    try {
      await sendMail({
        to: admin.email,
        subject: t("Prueba de email de Pizarro"),
        text: t("Si lees esto, el envío de emails de Pizarro funciona correctamente."),
      });
    } catch (err) {
      const message = sanitizeSmtpError(err, [config.pass, config.user]);
      logEvent({ level: "warn", category: "system", action: "settings.mailTestFailed", message: `Falló el email de prueba: ${message}`, userId: admin.id, userName: admin.name });
      throw new AppError(`${t("No se pudo enviar el email de prueba.")} ${message}`);
    }
    describeAction("Envió un email de prueba a {to}", { to: maskEmail(admin.email) });
    return { to: admin.email };
  });
}
