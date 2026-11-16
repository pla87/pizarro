"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { COMMENT_LIMIT_MAX, COMMENT_LIMIT_MIN, getMaxCommentsPerTask, setMaxCommentsPerTask } from "@/lib/app-settings";
import { changeAppIcon } from "@/lib/app-icon-save";
import { saveInstanceSettings } from "@/lib/instance";
import { requireAdmin } from "@/lib/session";

const commentLimit = z
  .number({ error: "Indica un número." })
  .int("Debe ser un número entero.")
  .min(COMMENT_LIMIT_MIN, "Debe estar entre 1 y 1000.")
  .max(COMMENT_LIMIT_MAX, "Debe estar entre 1 y 1000.");

/** Ajuste de administración: máximo de comentarios por tarea (los comentarios borrados con respuestas no cuentan). */
export async function saveMaxCommentsPerTask(value: number) {
  return runAction({ name: "settings.saveMaxCommentsPerTask", args: [value] }, async () => {
    await requireAdmin();
    const next = commentLimit.parse(value);
    const prev = await getMaxCommentsPerTask();
    await setMaxCommentsPerTask(next);
    describeAction("Cambió el máximo de comentarios por tarea de {from} a {to}", { from: prev, to: next });
    revalidatePath("/admin/settings");
    return { value: next };
  });
}

/** Administración → Ajustes → Instalación: nombre de la organización, idioma por defecto y zona horaria. */
export async function saveInstallationSettings(input: { orgName: string; locale: string; timeZone: string }) {
  return runAction({ name: "settings.saveInstallationSettings", args: [input] }, async () => {
    await requireAdmin();
    const { before, after } = await saveInstanceSettings(input);
    describeAction("Cambió los ajustes de la instalación", { before, after });
    // Nombre en los títulos, idioma de las pantallas sin sesión y zona de las fechas: cambia lo ya pintado.
    revalidatePath("/", "layout");
    return after;
  });
}

/**
 * Administración → Ajustes → «Icono de la app»: color del icono de esta instalación (pestaña, pantalla de inicio y app
 * instalada), para distinguirla de otra instalación de Pizarro en el mismo móvil.
 */
export async function saveAppIcon(accent: string) {
  // La misma función que usa el guardado con sendBeacon al cerrar la pestaña (/api/admin/app-icon).
  return runAction({ name: "settings.saveAppIcon", args: [accent] }, () => changeAppIcon(accent));
}
