import "server-only";
import { db } from "./db";
import { invalidateMemo, memo } from "./memo";
import {
  LICENSE_KEY, PERSONAL_USE_KEY, licenseStatus, parseLicense, parsePersonalUse, shouldShowLicenseNudge,
  type LicenseRecord, type LicenseStatus, type PersonalUseRecord,
} from "./license-core";

// Claves de la memoria en proceso (lib/memo.ts): el layout pregunta por el recordatorio en cada página de un admin.
const STATUS_MEMO = "license:status";
const INSTALLED_MEMO = "license:installedAt";
const snoozeMemo = (userId: string) => `license:snooze:${userId}`;

export async function getLicense(): Promise<LicenseRecord | null> {
  const row = await db.appState.findUnique({ where: { key: LICENSE_KEY }, select: { value: true } }).catch(() => null);
  return parseLicense(row?.value);
}

/** Registra la licencia: deja de figurar como «uso personal» (los dos estados se excluyen). */
export async function setLicense(rec: LicenseRecord): Promise<void> {
  const value = JSON.stringify(rec);
  await db.$transaction([
    db.appState.upsert({ where: { key: LICENSE_KEY }, create: { key: LICENSE_KEY, value }, update: { value } }),
    db.appState.deleteMany({ where: { key: PERSONAL_USE_KEY } }),
  ]);
  invalidateMemo(STATUS_MEMO);
}

export async function clearLicense(): Promise<void> {
  await db.appState.deleteMany({ where: { key: LICENSE_KEY } });
  invalidateMemo(STATUS_MEMO);
}

export async function getPersonalUse(): Promise<PersonalUseRecord | null> {
  const row = await db.appState.findUnique({ where: { key: PERSONAL_USE_KEY }, select: { value: true } }).catch(() => null);
  return parsePersonalUse(row?.value);
}

/** Declara la instalación de uso personal (quita la licencia registrada, si la había) o retira la declaración. */
export async function setPersonalUse(rec: PersonalUseRecord | null): Promise<void> {
  if (!rec) {
    await db.appState.deleteMany({ where: { key: PERSONAL_USE_KEY } });
    invalidateMemo(STATUS_MEMO);
    return;
  }
  const value = JSON.stringify({ personal: true, date: rec.date });
  await db.$transaction([
    db.appState.upsert({ where: { key: PERSONAL_USE_KEY }, create: { key: PERSONAL_USE_KEY, value }, update: { value } }),
    db.appState.deleteMany({ where: { key: LICENSE_KEY } }),
  ]);
  invalidateMemo(STATUS_MEMO);
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const [license, personal] = await Promise.all([getLicense(), getPersonalUse()]);
  return licenseStatus(license, personal);
}

/** Alta de la instalación: la fecha de creación del primer usuario (null si no hay ninguno). */
export async function installedAt(): Promise<Date | null> {
  const first = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return first?.createdAt ?? null;
}

/** Olvida hasta cuándo pospuso el recordatorio este admin (tras «Recordar más tarde»). */
export function invalidateLicenseNudge(userId: string): void {
  invalidateMemo(snoozeMemo(userId));
}

/**
 * ¿Ve este administrador el recordatorio de licencia ahora? Solo consulta la base si es admin, y lo justo: con licencia
 * registrada o uso personal declarado (lo normal) no hace nada más; todo, con memoria de un minuto (se invalida al
 * registrar, quitar o declarar, y al posponerlo). Nunca falla (ante cualquier error, no se muestra).
 */
export async function licenseNudgeFor(user: { id: string; role: "ADMIN" | "MEMBER" }, now = new Date()): Promise<boolean> {
  if (user.role !== "ADMIN") return false;
  try {
    const status = await memo(STATUS_MEMO, getLicenseStatus);
    if (status.kind !== "none") return false;
    const since = await memo(INSTALLED_MEMO, installedAt);
    // Aún dentro de los primeros días (o sin usuarios): no hace falta mirar si lo pospuso.
    if (!shouldShowLicenseNudge({ role: user.role, status: status.kind, installedAt: since, snoozedUntil: null, now })) return false;
    const snoozedUntil = await memo(snoozeMemo(user.id), async () => (await db.user.findUnique({ where: { id: user.id }, select: { licenseNudgeUntil: true } }))?.licenseNudgeUntil ?? null);
    return shouldShowLicenseNudge({ role: user.role, status: status.kind, installedAt: since, snoozedUntil, now });
  } catch {
    return false;
  }
}
