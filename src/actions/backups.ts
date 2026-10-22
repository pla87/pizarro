"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { createBackup, backupKey } from "@/lib/backup";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/session";

/** Crea una copia de seguridad cifrada ahora mismo (solo administradores). */
export async function createBackupNow() {
  return runAction({ name: "backups.createBackupNow" }, async () => {
    await requireAdmin();
    if (!backupKey()) throw new AppError("Las copias de seguridad están desactivadas: falta una BACKUP_KEY válida.");
    const run = await createBackup();
    if (!run.ok) throw new AppError(`No se pudo crear la copia: ${run.error ?? "error desconocido"}`);
    revalidatePath("/admin/backups");
    return { file: run.file ?? "", bytes: run.bytes ?? 0 };
  });
}
