// Aviso de «copia de seguridad atrasada». Lógica pura (sin base de datos ni disco) para poder probarla.

/** Si la última copia correcta es más antigua que esto, se avisa. */
export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
/** Como mucho un email de aviso a los administradores cada 24 h. */
export const BACKUP_ALERT_MAIL_EVERY_MS = 24 * 60 * 60 * 1000;

export interface BackupAlert {
  active: boolean;
  /** "none": hay clave pero no existe ninguna copia correcta. "stale": la última tiene más de 48 h. */
  reason: "none" | "stale" | null;
  /** ISO de la última copia correcta (null si no hay). */
  lastAt: string | null;
}

/**
 * ¿Hay que avisar? Solo con BACKUP_KEY válida (sin clave las copias están desactivadas a propósito y ya se avisa aparte).
 * `lastOkAt` es la fecha de la última copia correcta (la más reciente entre el estado y los ficheros), o null.
 */
export function backupAlertFor(opts: { keyOk: boolean; lastOkAt: number | null; now: number }): BackupAlert {
  const valid = opts.lastOkAt !== null && Number.isFinite(opts.lastOkAt);
  const lastAt = valid ? new Date(opts.lastOkAt!).toISOString() : null;
  if (!opts.keyOk) return { active: false, reason: null, lastAt };
  if (!valid) return { active: true, reason: "none", lastAt: null };
  return opts.now - opts.lastOkAt! > BACKUP_STALE_MS ? { active: true, reason: "stale", lastAt } : { active: false, reason: null, lastAt };
}

/** ¿Toca enviar otro email? `lastMailAt` es el último envío guardado (ms) o null. */
export function backupAlertMailDue(lastMailAt: number | null, now: number): boolean {
  return lastMailAt === null || !Number.isFinite(lastMailAt) || now - lastMailAt >= BACKUP_ALERT_MAIL_EVERY_MS;
}
