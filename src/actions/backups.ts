"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { backupDestinationsInfo, backupKey, createBackup, startExternalCopy } from "@/lib/backup";
import { issueBackupDownloadToken } from "@/lib/backup-download";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/session";
import { verifyTotpFor } from "@/lib/two-factor";

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

/**
 * Sube ya la última copia a los destinos externos (en segundo plano: con muchos ficheros puede tardar). El resultado
 * se ve en la página al recargar y en los logs.
 */
export async function copyToExternalNow() {
  return runAction({ name: "backups.copyToExternalNow" }, async () => {
    await requireAdmin();
    if (!backupKey()) throw new AppError("Las copias de seguridad están desactivadas: falta una BACKUP_KEY válida.");
    const info = backupDestinationsInfo();
    if (info.external.length === 0) throw new AppError(info.errors[0] ?? "No hay ningún destino externo configurado.");
    if (!startExternalCopy()) throw new AppError("Ya hay una copia en curso.");
    revalidatePath("/admin/backups");
    return { started: true };
  });
}

/**
 * Confirma la identidad antes de descargar la copia y devuelve un token de un solo uso (60 s) para la ruta de descarga.
 * Se acepta la contraseña actual o, para quien entra con Google y no tiene contraseña propia, un código de su app
 * de verificación en dos pasos (TOTP). Sin ninguna de las dos cosas no hay descarga. Nunca se pasan secretos a runAction.
 */
export async function requestBackupDownload(input: { password?: string; code?: string }) {
  return runAction({ name: "backups.requestDownload", args: [] }, async () => {
    const admin = await requireAdmin();
    const fail = (kind: "code" | "password"): never => {
      logEvent({ level: "warn", category: "auth", action: "backups.downloadDenied", message: `${admin.name}: confirmación fallida para descargar la copia (${kind})`, userId: admin.id, userName: admin.name });
      throw new AppError(kind === "code" ? "Código incorrecto o caducado." : "La contraseña no es correcta.");
    };
    if (!rateLimit(`backup-dl:${admin.id}`, 5, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id }, select: { passwordHash: true, twoFactorMethod: true, totpSecretEnc: true, totpLastStep: true } });
    if (input.code) {
      if (row.twoFactorMethod !== "TOTP") throw new AppError("Para descargar la copia confirma con tu contraseña.");
      if (!(await verifyTotpFor(row.totpSecretEnc, String(input.code).replace(/\s/g, "").slice(0, 12), admin.id, row.totpLastStep))) fail("code");
    } else if (!(await verifyPassword(String(input.password ?? "").slice(0, 200), row.passwordHash))) {
      fail("password");
    }
    logEvent({ category: "auth", action: "backups.downloadAuthorized", message: `${admin.name} ha confirmado su identidad para descargar la copia`, userId: admin.id, userName: admin.name });
    return { token: issueBackupDownloadToken(admin.id) };
  });
}
