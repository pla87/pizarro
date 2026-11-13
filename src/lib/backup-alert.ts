import "server-only";
import { cache } from "react";
import { sendBackupAlertMail } from "./auth-mail";
import { backupAlertFor, backupAlertMailDue, type BackupAlert } from "./backup-alert-core";
import { BACKUP_ALERT_MEMO, backupDestinationsInfo, backupKeyState, latestBackupTime, readStatus } from "./backup";
import { stemDate } from "./backup-dest";
import { db } from "./db";
import { logEvent } from "./log";
import { memo } from "./memo";
import { emailEnabled } from "./mail";
import { logMailError } from "./mask-email";

const MAIL_STATE_KEY = "backupAlertMailAt";

/**
 * Estado actual del aviso de copias (lee status.json y los nombres de la carpeta de copias, sin un stat por copia; barato).
 */
export async function computeBackupAlert(now: number = Date.now()): Promise<BackupAlert> {
  const keyOk = backupKeyState() === "ok";
  if (!keyOk) return backupAlertFor({ keyOk, lastOkAt: null, now });
  const [status, latest] = await Promise.all([readStatus(), latestBackupTime()]);
  const times = [status.lastBackup?.ok ? Date.parse(status.lastBackup.at) : NaN, latest ?? NaN].filter(Number.isFinite);
  // Destino externo: cuenta el que lleve más tiempo sin una subida correcta (una configuración incompleta cuenta como «nunca»).
  const ext = backupDestinationsInfo();
  const configured = ext.external.length > 0 || ext.errors.length > 0;
  const extTimes = ext.external.map((d) => Date.parse(status.external?.[d.id]?.lastOkAt ?? ""));
  const extLast = !configured || ext.errors.length > 0 || extTimes.some((t) => !Number.isFinite(t)) ? null : Math.min(...extTimes);
  const sh = status.shrink;
  const day = (stem: string) => stemDate(stem)?.toISOString() ?? null;
  const shrink = sh ? { what: sh.what, local: sh.local, remote: sh.remote, stem: sh.stem, goodStem: sh.goodStem, at: day(sh.stem), goodAt: day(sh.goodStem) } : null;
  return backupAlertFor({ keyOk, lastOkAt: times.length > 0 ? Math.max(...times) : null, now, external: { configured, lastOkAt: extLast }, shrink });
}

/**
 * Igual, memorizado por petición (el layout y la página de copias lo piden en la misma pasada) y en el proceso durante un
 * minuto: el layout lo pide en cada página de un admin. Cada copia y cada cambio de status.json lo invalidan
 * (BACKUP_MEMO en backup.ts).
 */
export const getBackupAlert = cache(() => memo(BACKUP_ALERT_MEMO, () => computeBackupAlert()));

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
      await sendBackupAlertMail(a, { lastAt: alert.lastAt, external: alert.reason === "externalNone" || alert.reason === "externalStale", shrink: alert.shrink });
      sent++;
    } catch (err) {
      logMailError("[backup-alert] email", err);
    }
  }
  logEvent({
    level: "warn", category: "system", action: "backup.alertMailed",
    message: alert.reason === "shrunk" ? `Aviso de copia de seguridad mucho menor que la anterior enviado a ${sent} administrador(es)` : `Aviso de copia de seguridad atrasada enviado a ${sent} administrador(es)`, details: { sent, admins: admins.length, lastAt: alert.lastAt, reason: alert.reason },
  });
  return sent;
}
