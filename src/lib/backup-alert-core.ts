// Aviso de «copia de seguridad atrasada». Lógica pura (sin base de datos ni disco) para poder probarla.
import type { T } from "@/i18n/shared";

/** Si la última copia correcta es más antigua que esto, se avisa. */
export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
/** Como mucho un email de aviso a los administradores cada 24 h. */
export const BACKUP_ALERT_MAIL_EVERY_MS = 24 * 60 * 60 * 1000;

/** La copia local más reciente es mucho menor que la última buena (lastGoodCopy en backup-dest.ts). */
export interface BackupShrinkInfo {
  /** "core": personas, proyectos y tareas; "rows": filas en total (manifiestos antiguos); "files": ficheros. */
  what: "core" | "rows" | "files";
  /** Cuántos tiene la copia nueva y cuántos la última buena. */
  local: number;
  remote: number;
  /** Raíz de la copia nueva y de la última buena (pizarro-backup-AAAAMMDDTHHMMSSZ). */
  stem: string;
  goodStem: string;
  /** Fechas (ISO) de las dos copias, sacadas de sus nombres. */
  at: string | null;
  goodAt: string | null;
}

/** Párrafo que explica la reducción (página de copias y email), con las fechas en el idioma de quien lo lee. */
export function shrinkText(s: BackupShrinkInfo, t: T, date: (iso: string) => string): string {
  const vars = { date: s.at ? date(s.at) : s.stem, goodDate: s.goodAt ? date(s.goodAt) : s.goodStem, n: s.local, m: s.remote };
  return s.what === "core"
    ? t("La copia del {date} tiene {n} personas, proyectos y tareas, y la última copia buena, del {goodDate}, tenía {m}.", vars)
    : s.what === "files"
      ? t("La copia del {date} tiene {n} ficheros, y la última copia buena, del {goodDate}, tenía {m}.", vars)
      : t("La copia del {date} tiene {n} filas en la base de datos, y la última copia buena, del {goodDate}, tenía {m}.", vars);
}

export interface BackupAlert {
  active: boolean;
  /**
   * "none": hay clave pero no existe ninguna copia correcta. "stale": la última tiene más de 48 h.
   * "shrunk": la última copia es mucho menor que la última buena (¿se han perdido los datos?).
   * "externalNone" / "externalStale": lo mismo con la última copia subida al destino externo (si hay uno configurado).
   */
  reason: "none" | "stale" | "shrunk" | "externalNone" | "externalStale" | null;
  /** ISO de la última copia correcta (null si no hay); con los motivos «external…», la de la última copia externa. */
  lastAt: string | null;
  /** Solo con «shrunk»: qué se redujo y cuánto. */
  shrink?: BackupShrinkInfo;
}

const iso = (ms: number | null) => (ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * ¿Hay que avisar? Solo con BACKUP_KEY válida (sin clave las copias están desactivadas a propósito y ya se avisa aparte).
 * `lastOkAt` es la fecha de la última copia correcta (la más reciente entre el estado y los ficheros), o null.
 * `external`: si hay destino externo configurado, la fecha de la última subida correcta (la más antigua entre los destinos).
 * `shrink`: la última copia local es mucho menor que la última buena (null o ausente si no).
 * Primero cuenta que la copia local exista y esté al día; después, que no sea sospechosamente pequeña; después, la externa.
 */
export function backupAlertFor(opts: { keyOk: boolean; lastOkAt: number | null; now: number; external?: { configured: boolean; lastOkAt: number | null }; shrink?: BackupShrinkInfo | null }): BackupAlert {
  const lastAt = iso(opts.lastOkAt);
  if (!opts.keyOk) return { active: false, reason: null, lastAt };
  if (lastAt === null) return { active: true, reason: "none", lastAt: null };
  if (opts.now - opts.lastOkAt! > BACKUP_STALE_MS) return { active: true, reason: "stale", lastAt };
  if (opts.shrink) return { active: true, reason: "shrunk", lastAt, shrink: opts.shrink };
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
