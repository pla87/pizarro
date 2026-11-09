"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { LICENSE_EMAIL_MAX, LICENSE_HOLDER_MAX, LICENSE_REF_MAX, nudgeSnoozeUntil } from "@/lib/license-core";
import { clearLicense, getLicense, getPersonalUse, setLicense, setPersonalUse } from "@/lib/license-registry";
import { requireAdmin } from "@/lib/session";

const input = z.object({
  holder: z.string().trim().min(1, "Indica el titular de la licencia.").max(LICENSE_HOLDER_MAX, "El titular es demasiado largo."),
  reference: z.string().trim().max(LICENSE_REF_MAX, "La referencia es demasiado larga."),
  email: z.string().trim().max(LICENSE_EMAIL_MAX, "El email es demasiado largo.").refine((v) => v === "" || z.email().safeParse(v).success, "El email no es válido."),
});

const today = () => new Date().toISOString().slice(0, 10);

/** Anota los datos de la licencia comercial de esta instalación. Solo informativo: no activa ni bloquea nada. */
export async function saveLicense(value: { holder: string; reference: string; email: string }) {
  return runAction({ name: "settings.saveLicense" }, async () => {
    await requireAdmin();
    const v = input.parse(value);
    const prev = await getLicense();
    const same = prev && prev.holder === v.holder && prev.reference === v.reference;
    const rec = { ...v, date: same ? prev.date : today() };
    await setLicense(rec);
    if (rec.reference) describeAction("Registró la licencia comercial: {holder} ({reference})", { holder: rec.holder, reference: rec.reference });
    else describeAction("Registró la licencia comercial: {holder}", { holder: rec.holder });
    revalidatePath("/", "layout");
    return rec;
  });
}

/** Quita los datos de licencia registrados (la instalación vuelve a figurar «sin licencia registrada»). */
export async function removeLicense() {
  return runAction({ name: "settings.removeLicense" }, async () => {
    await requireAdmin();
    const prev = await getLicense();
    await clearLicense();
    describeAction("Quitó el registro de la licencia comercial{who}", { who: prev ? `: ${prev.holder}${prev.reference ? ` (${prev.reference})` : ""}` : "" });
    revalidatePath("/", "layout");
    return null;
  });
}

/**
 * Declara que la instalación es de uso personal (o retira la declaración). Oculta para siempre el recordatorio de
 * licencia en toda la instalación. Si había una licencia registrada, se quita (los dos estados se excluyen).
 */
export async function setPersonalUseDeclared(personal: boolean) {
  return runAction({ name: "settings.setPersonalUse" }, async () => {
    await requireAdmin();
    const flag = z.boolean().parse(personal);
    if (flag) {
      const rec = (await getPersonalUse()) ?? { date: today() };
      await setPersonalUse(rec);
      describeAction("Declaró la instalación de uso personal");
      revalidatePath("/", "layout");
      return rec;
    }
    await setPersonalUse(null);
    describeAction("Retiró la declaración de uso personal");
    revalidatePath("/", "layout");
    return null;
  });
}

/**
 * El administrador ha visto el recordatorio de licencia (o ha pulsado «Recordar más tarde»): no se le vuelve a mostrar
 * hasta dentro de 30 días. Sin revalidar: el aviso visible sigue en pantalla hasta que lo cierre.
 */
export async function snoozeLicenseNudge() {
  return runAction({ name: "settings.snoozeLicenseNudge" }, async () => {
    const me = await requireAdmin();
    const until = nudgeSnoozeUntil(new Date());
    await db.user.update({ where: { id: me.id }, data: { licenseNudgeUntil: until } });
    describeAction("Vio el recordatorio de licencia (no se repite hasta el {date})", { date: until.toISOString().slice(0, 10) });
    return null;
  });
}
