"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { envGoogleCredentials, validateGoogleSettings, type GoogleSettingsInput } from "@/lib/google-config-core";
import { saveGoogleSettings as persist } from "@/lib/google-config";
import { requireAdmin } from "@/lib/session";

// Administración → Ajustes → «Acceso con Google». Solo administradores. El secreto nunca se registra ni se devuelve.
// Los args de la acción NO se pasan a runAction (llevarían el secreto al registro).

export interface GoogleSettingsForm extends GoogleSettingsInput {
  /** Secreto de cliente nuevo; vacío o ausente = conservar el guardado. */
  secret?: string;
}

export async function saveGoogleSettings(form: GoogleSettingsForm) {
  return runAction({ name: "settings.saveGoogle" }, async () => {
    await requireAdmin();
    if (envGoogleCredentials()) throw new AppError("Google está configurado en el servidor (variables GOOGLE_*) y no se puede cambiar aquí.");
    const checked = validateGoogleSettings(form);
    if (!checked.ok) throw new AppError(checked.error);
    const secret = typeof form.secret === "string" ? form.secret.trim() : "";
    if (secret.length > 500 || /[\r\n]/.test(secret)) throw new AppError("El secreto de cliente no es válido.");
    const { secretChange, before, after } = await persist(checked.value, { secret });
    // Sin ID ni secreto en el registro: solo qué cambió.
    describeAction("Cambió la configuración del acceso con Google", {
      enabled: Boolean(after.clientId),
      was: Boolean(before.clientId),
      clientIdChanged: before.clientId !== after.clientId,
      domain: after.workspaceDomain || null,
      authChange: secretChange,
    });
    revalidatePath("/admin/settings");
    return { settings: after };
  });
}
