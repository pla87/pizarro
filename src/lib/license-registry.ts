import "server-only";
import { db } from "./db";
import { LICENSE_KEY, parseLicense, type LicenseRecord } from "./license-core";

export async function getLicense(): Promise<LicenseRecord | null> {
  const row = await db.appState.findUnique({ where: { key: LICENSE_KEY }, select: { value: true } }).catch(() => null);
  return parseLicense(row?.value);
}

export async function setLicense(rec: LicenseRecord): Promise<void> {
  const value = JSON.stringify(rec);
  await db.appState.upsert({ where: { key: LICENSE_KEY }, create: { key: LICENSE_KEY, value }, update: { value } });
}

export async function clearLicense(): Promise<void> {
  await db.appState.deleteMany({ where: { key: LICENSE_KEY } });
}
