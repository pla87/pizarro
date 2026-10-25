"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { COMMENT_LIMIT_MAX, COMMENT_LIMIT_MIN, getMaxCommentsPerTask, setMaxCommentsPerTask } from "@/lib/app-settings";
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
