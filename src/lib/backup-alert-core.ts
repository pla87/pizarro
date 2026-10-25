// Aviso de «copia de seguridad atrasada». Lógica pura (sin base de datos ni disco) para poder probarla.

/** Si la última copia correcta es más antigua que esto, se avisa. */
export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
/** Como mucho un email de aviso a los administradores cada 24 h. */
export const BACKUP_ALERT_MAIL_EVERY_MS = 24 * 60 * 60 * 1000;

export interface BackupAlert {
  active: boolean;
  /**
   * "none": hay clave pero no existe ninguna copia correcta. "stale": la última tiene más de 48 h.
   * "externalNone" / "externalStale": lo mismo con la última copia subida al destino externo (si hay uno configurado).
   */
  reason: "none" | "stale" | "externalNone" | "externalStale" | null;
  /** ISO de la última copia correcta (null si no hay); con los motivos «external…», la de la última copia externa. */
  lastAt: string | null;
}

const iso = (ms: number | null) => (ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * ¿Hay que avisar? Solo con BACKUP_KEY válida (sin clave las copias están desactivadas a propósito y ya se avisa aparte).
 * `lastOkAt` es la fecha de la última copia correcta (la más reciente entre el estado y los ficheros), o null.
 * `external`: si hay destino externo configurado, la fecha de la última subida correcta (la más antigua entre los destinos).
 * Primero cuenta la copia local; si está bien, la externa.
 */
export function backupAlertFor(opts: { keyOk: boolean; lastOkAt: number | null; now: number; external?: { configured: boolean; lastOkAt: number | null } }): BackupAlert {
  const lastAt = iso(opts.lastOkAt);
  if (!opts.keyOk) return { active: false, reason: null, lastAt };
  if (lastAt === null) return { active: true, reason: "none", lastAt: null };
  if (opts.now - opts.lastOkAt! > BACKUP_STALE_MS) return { active: true, reason: "stale", lastAt };
  if (opts.external?.configured) {
    const extAt = iso(opts.external.lastOkAt);
    if (extAt === null) return { active: true, reason: "externalNone", lastAt: null };
    if (opts.now - opts.external.lastOkAt! > BACKUP_STALE_MS) return { active: true, reason: "externalStale", lastAt: extAt };
  }
  return { active: false, reason: null, lastAt };
}

/** ¿Toca enviar otro email? `lastMailAt` es el último envío guardado (ms) o null. */
export function backupAlertMailDue(lastMailAt: number | null, now: number): boolean {
  return lastMailAt === null || !Number.isFinite(lastMailAt) || now - lastMailAt >= BACKUP_ALERT_MAIL_EVERY_MS;
}
