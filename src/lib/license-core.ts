// Registro de la licencia comercial de esta instalación (solo informativo: no bloquea ninguna función).
export const LICENSE_KEY = "commercialLicense";
export const LICENSE_HOLDER_MAX = 200;
export const LICENSE_REF_MAX = 120;
export const LICENSE_EMAIL_MAX = 200;

export interface LicenseRecord {
  holder: string;
  reference: string;
  /** Email con el que se compró (opcional). */
  email: string;
  /** Fecha del registro, AAAA-MM-DD. */
  date: string;
}

/** Interpreta lo guardado; cualquier valor que no cuadre cuenta como «sin licencia registrada». */
export function parseLicense(raw: string | null | undefined): LicenseRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const s = (x: unknown) => (typeof x === "string" ? x : "");
    const holder = s(v.holder).trim();
    const reference = s(v.reference).trim();
    if (!holder || !reference) return null;
    return { holder, reference, email: s(v.email).trim(), date: s(v.date) };
  } catch {
    return null;
  }
}
