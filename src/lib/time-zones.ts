// Lista de zonas horarias para el campo con búsqueda de /setup y de Administración → Ajustes → Instalación. Sin nada del
// servidor: la usan la página (con Intl.supportedValuesOf, que da ~420 zonas) y el campo del navegador.
//
// Intl (ICU) aún da nombres antiguos de algunas zonas (Asia/Calcutta, Europe/Kiev, America/Buenos_Aires…): se muestran con
// su nombre actual de la base de datos IANA. Una zona antigua ya guardada sigue valiendo (Intl acepta las dos) y se
// muestra con su nombre actual; al guardar de nuevo se guarda el actual.

/** Nombre antiguo → actual (IANA). Solo los que Intl.supportedValuesOf todavía devuelve con el nombre antiguo. */
const TZ_ALIASES: Readonly<Record<string, string>> = {
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** Las habituales, arriba de la lista (en este orden). */
export const COMMON_TIME_ZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "UTC",
] as const;

/** Nombre actual de una zona (el mismo si no es un alias antiguo). */
export function currentTimeZoneName(tz: string): string {
  return TZ_ALIASES[tz] ?? tz;
}

/**
 * Zonas para el campo: las habituales primero y luego el resto por orden alfabético, todas con su nombre actual, sin
 * repetir y con UTC (Intl no la incluye). `supported`: Intl.supportedValuesOf("timeZone") o, si no existe, lo que haya.
 */
export function timeZoneOptions(supported: readonly string[]): string[] {
  const all = new Set(supported.map(currentTimeZoneName));
  all.add("UTC");
  const common = COMMON_TIME_ZONES.filter((z) => all.has(z) || z === "UTC");
  const rest = [...all].filter((z) => !(COMMON_TIME_ZONES as readonly string[]).includes(z)).sort();
  return [...common, ...rest];
}

/**
 * Lo escrito en el campo → una zona de la lista: tal cual, sin distinguir mayúsculas ni espacios (con «_» o con espacios:
 * «america/new york»), o un nombre antiguo. Si no es ninguna, null (no se puede guardar).
 */
export function matchTimeZone(input: string, options: readonly string[]): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const current = currentTimeZoneName(raw);
  if (options.includes(current)) return current;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "_");
  const wanted = norm(raw);
  const found = options.find((z) => norm(z) === wanted) ?? Object.keys(TZ_ALIASES).find((old) => norm(old) === wanted);
  return found ? currentTimeZoneName(found) : null;
}
