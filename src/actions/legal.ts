"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { isPlainEmail } from "@/lib/google-config-core";
import { saveLegalContact, saveLegalTexts } from "@/lib/legal";
import { isLegalKind, LEGAL_RESPONSIBLE_MAX, validateLegalText } from "@/lib/legal-core";
import { requireAdmin } from "@/lib/session";

// Administración → Textos legales. Solo administradores. Los textos se muestran como Markdown seguro (sin HTML).

/** Guarda el texto propio (español e inglés) de /privacy o /terms. Vacío = texto por defecto. */
export async function saveLegalPage(input: { kind: string; es: string; en: string }) {
  return runAction({ name: "legal.savePage" }, async () => {
    await requireAdmin();
    if (!isLegalKind(input?.kind)) throw new AppError("Página no válida.");
    const es = validateLegalText(input.es);
    if (!es.ok) throw new AppError(es.error);
    const en = validateLegalText(input.en);
    if (!en.ok) throw new AppError(en.error);
    const kind = input.kind;
    const { changed, settings } = await saveLegalTexts(kind, { es: es.value, en: en.value });
    // Sin el contenido en el registro: solo qué página, qué idiomas y cuánto mide.
    describeAction(
      kind === "privacy" ? "Cambió el texto legal de la política de privacidad" : "Cambió el texto legal de las condiciones del servicio",
      { changed, esChars: es.value.length, enChars: en.value.length, custom: Boolean(es.value || en.value) },
    );
    revalidatePath("/privacy");
    revalidatePath("/terms");
    revalidatePath("/admin/legal");
    return { texts: settings.texts[kind], updatedAt: settings.updatedAt[kind] };
  });
}

/** Guarda el nombre del responsable y el email de contacto público. */
export async function saveLegalIdentity(input: { responsible: string; email: string }) {
  return runAction({ name: "legal.saveIdentity" }, async () => {
    await requireAdmin();
    const responsible = typeof input?.responsible === "string" ? input.responsible.replace(/\s+/g, " ").trim() : "";
    const email = typeof input?.email === "string" ? input.email.trim() : "";
    if (responsible.length > LEGAL_RESPONSIBLE_MAX) throw new AppError("El nombre del responsable es demasiado largo (máximo 200 caracteres).");
    if (email && !isPlainEmail(email)) throw new AppError("El email de contacto público no es válido.");
    const r = await saveLegalContact(responsible, email);
    describeAction("Cambió el responsable y el contacto de los textos legales", r);
    revalidatePath("/privacy");
    revalidatePath("/terms");
    revalidatePath("/admin/legal");
    revalidatePath("/admin/settings");
    return { responsible, email };
  });
}
