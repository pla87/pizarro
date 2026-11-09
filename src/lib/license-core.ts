// Registro de la licencia comercial de esta instalación (solo informativo: no bloquea ninguna función) y lógica del
// recordatorio para administradores. Sin dependencias del servidor: lo usan también las pruebas unitarias.
export const LICENSE_KEY = "commercialLicense";
/** Declaración «es uso personal» de la instalación (AppState). Excluye a la licencia registrada y viceversa. */
export const PERSONAL_USE_KEY = "licensePersonalUse";
export const LICENSE_HOLDER_MAX = 200;
export const LICENSE_REF_MAX = 120;
export const LICENSE_EMAIL_MAX = 200;

/** El recordatorio no sale hasta pasados estos días desde que se creó la instalación (primer usuario). */
export const LICENSE_NUDGE_GRACE_DAYS = 7;
/** El recordatorio se ve como mucho una vez cada estos días por administrador («Recordar más tarde»). */
export const LICENSE_NUDGE_SNOOZE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LicenseRecord {
  holder: string;
  /** Nº de factura o recibo de compra (opcional). */
  reference: string;
  /** Email con el que se compró (opcional). */
  email: string;
  /** Fecha del registro, AAAA-MM-DD. */
  date: string;
}

export interface PersonalUseRecord {
  /** Fecha de la declaración, AAAA-MM-DD. */
  date: string;
}

/** Estado de licencia de la instalación, tal como se muestra en Administración → Licencia. */
export type LicenseStatus = { kind: "licensed"; license: LicenseRecord } | { kind: "personal"; personal: PersonalUseRecord } | { kind: "none" };

const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Interpreta lo guardado; cualquier valor que no cuadre cuenta como «sin licencia registrada». */
export function parseLicense(raw: string | null | undefined): LicenseRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const holder = str(v?.holder).trim();
    if (!holder) return null;
    return { holder, reference: str(v.reference).trim(), email: str(v.email).trim(), date: str(v.date) };
  } catch {
    return null;
  }
}

/** Interpreta la declaración de uso personal; cualquier valor ilegible cuenta como «no declarada». */
export function parsePersonalUse(raw: string | null | undefined): PersonalUseRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return v && typeof v === "object" && v.personal === true ? { date: str(v.date) } : null;
  } catch {
    return null;
  }
}

/** La licencia registrada manda sobre la declaración de uso personal (no deberían coexistir). */
export function licenseStatus(license: LicenseRecord | null, personal: PersonalUseRecord | null): LicenseStatus {
  if (license) return { kind: "licensed", license };
  if (personal) return { kind: "personal", personal };
  return { kind: "none" };
}

export interface NudgeInput {
  role: "ADMIN" | "MEMBER";
  status: LicenseStatus["kind"];
  /** Alta de la instalación (fecha de creación del primer usuario); null si no se sabe. */
  installedAt: Date | null;
  /** Hasta cuándo lo tiene pospuesto este administrador (null: no lo ha pospuesto nunca). */
  snoozedUntil: Date | null;
  now: Date;
}

/**
 * ¿Ve este usuario el recordatorio de licencia? Solo administradores, solo si la instalación no tiene licencia
 * registrada ni está declarada de uso personal, nunca en los primeros días tras crear la instalación y como mucho
 * una vez cada 30 días por administrador. Nunca bloquea nada: es un aviso descartable.
 */
export function shouldShowLicenseNudge({ role, status, installedAt, snoozedUntil, now }: NudgeInput): boolean {
  if (role !== "ADMIN" || status !== "none" || !installedAt) return false;
  if (now.getTime() - installedAt.getTime() < LICENSE_NUDGE_GRACE_DAYS * DAY_MS) return false;
  if (snoozedUntil && now.getTime() < snoozedUntil.getTime()) return false;
  return true;
}

/** Hasta cuándo queda pospuesto el recordatorio si se muestra (o se pospone) en `now`. */
export function nudgeSnoozeUntil(now: Date): Date {
  return new Date(now.getTime() + LICENSE_NUDGE_SNOOZE_DAYS * DAY_MS);
}
