"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { LICENSE_EMAIL_MAX, LICENSE_HOLDER_MAX, LICENSE_REF_MAX } from "@/lib/license-core";
import { clearLicense, getLicense, setLicense } from "@/lib/license-registry";
import { requireAdmin } from "@/lib/session";

const input = z.object({
  holder: z.string().trim().min(1, "Indica el titular de la licencia.").max(LICENSE_HOLDER_MAX, "El titular es demasiado largo."),
  reference: z.string().trim().min(1, "Indica el número de factura o la referencia de compra.").max(LICENSE_REF_MAX, "La referencia es demasiado larga."),
  email: z.string().trim().max(LICENSE_EMAIL_MAX, "El email es demasiado largo.").refine((v) => v === "" || z.email().safeParse(v).success, "El email no es válido."),
});

/** Anota los datos de la licencia comercial de esta instalación. Solo informativo: no activa ni bloquea nada. */
export async function saveLicense(value: { holder: string; reference: string; email: string }) {
  return runAction({ name: "settings.saveLicense" }, async () => {
    await requireAdmin();
    const v = input.parse(value);
    const prev = await getLicense();
    const same = prev && prev.holder === v.holder && prev.reference === v.reference;
    const rec = { ...v, date: same ? prev.date : new Date().toISOString().slice(0, 10) };
    await setLicense(rec);
    describeAction("Registró la licencia comercial: {holder} ({reference})", { holder: rec.holder, reference: rec.reference });
    revalidatePath("/admin/license");
    return rec;
  });
}

/** Quita los datos de licencia registrados (la instalación vuelve a figurar como de uso personal). */
export async function removeLicense() {
  return runAction({ name: "settings.removeLicense" }, async () => {
    await requireAdmin();
    const prev = await getLicense();
    await clearLicense();
    describeAction("Quitó el registro de la licencia comercial{who}", { who: prev ? `: ${prev.holder} (${prev.reference})` : "" });
    revalidatePath("/admin/license");
    return null;
  });
}
