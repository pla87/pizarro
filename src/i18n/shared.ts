// Parte del sistema de traducciones que no depende del diccionario de inglés (src/i18n/en/*, ~200 KB): tipos,
// interpolación y utilidades de idioma. Es lo único que entra en el JavaScript del navegador de todos los usuarios;
// el diccionario viaja aparte y solo a quien usa la app en inglés (ver client.tsx). El servidor y las pruebas usan
// core.ts, que sí lo incluye.

export type Locale = "es" | "en";
export type Vars = Record<string, string | number>;
export type T = (text: string, vars?: Vars) => string;
type Dictionary = Record<string, string>;

/** Sustituye las variables {nombre} del texto. */
function interpolate(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Traduce con el diccionario dado; sin diccionario (español) o sin entrada, devuelve el propio texto. */
export function translateWith(dict: Dictionary | undefined, text: string, vars?: Vars): string {
  return interpolate(dict ? (dict[text] ?? text) : text, vars);
}

export function makeTWith(dict: Dictionary | undefined): T {
  return (text, vars) => translateWith(dict, text, vars);
}

/** Traductor en español (el texto es la clave): valor por defecto de los módulos de cliente que no deben cargar el diccionario. */
export const esT: T = makeTWith(undefined);

/** Locale de Intl para fechas y números. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "es-ES";
}

/** Valor de la base de datos (ES/EN) a Locale. */
export function toLocale(value: string | null | undefined): Locale {
  return value === "EN" || value === "en" ? "en" : "es";
}
