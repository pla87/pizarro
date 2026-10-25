import "server-only";
import { cache } from "react";
import { sendBackupAlertMail } from "./auth-mail";
import { backupAlertFor, backupAlertMailDue, type BackupAlert } from "./backup-alert-core";
import { backupKeyState, listBackups, readStatus } from "./backup";
import { db } from "./db";
import { logEvent } from "./log";
import { emailEnabled } from "./mail";

const MAIL_STATE_KEY = "backupAlertMailAt";

/** Estado actual del aviso de copia atrasada (lee status.json y la carpeta de copias; barato). */
export async function computeBackupAlert(now: number = Date.now()): Promise<BackupAlert> {
  const keyOk = backupKeyState() === "ok";
  if (!keyOk) return backupAlertFor({ keyOk, lastOkAt: null, now });
  const [status, [latest]] = await Promise.all([readStatus(), listBackups()]);
  const times = [status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : NaN, latest ? Date.parse(latest.at) : NaN].filter(Number.isFinite);
  return backupAlertFor({ keyOk, lastOkAt: times.length > 0 ? Math.max(...times) : null, now });
}

/** Igual, memorizado por petición (el layout y la página de copias lo piden en la misma pasada). */
export const getBackupAlert = cache(() => computeBackupAlert());

/**
 * Lo llama el mantenimiento: si hay aviso activo y el email está configurado, avisa a los administradores activos
 * como mucho una vez cada 24 h (la fecha del último envío se guarda en AppState, así un reinicio no lo repite).
 * Devuelve el número de emails enviados.
 */
export async function notifyBackupAlertIfDue(now: number = Date.now()): Promise<number> {
  if (!emailEnabled()) return 0;
  const alert = await computeBackupAlert(now);
  if (!alert.active) return 0;
  const row = await db.appState.findUnique({ where: { key: MAIL_STATE_KEY } });
  if (!backupAlertMailDue(row ? Date.parse(row.value) : null, now)) return 0;
  // Se reserva el turno ANTES de enviar y de forma condicional: dos procesos a la vez no duplican el aviso.
  const stamp = new Date(now).toISOString();
  if (row) {
    const { count } = await db.appState.updateMany({ where: { key: MAIL_STATE_KEY, value: row.value }, data: { value: stamp } });
    if (count !== 1) return 0;
  } else {
    try {
      await db.appState.create({ data: { key: MAIL_STATE_KEY, value: stamp } });
    } catch {
      return 0;
    }
  }
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { name: true, email: true, locale: true } });
  let sent = 0;
  for (const a of admins) {
    try {
      await sendBackupAlertMail(a, { lastAt: alert.lastAt });
      sent++;
    } catch (err) {
      console.error("[backup-alert] email", err);
    }
  }
  logEvent({
    level: "warn", category: "system", action: "backup.alertMailed",
    message: `Aviso de copia de seguridad atrasada enviado a ${sent} administrador(es)`, details: { sent, admins: admins.length, lastAt: alert.lastAt, reason: alert.reason },
  });
  return sent;
}
