// Traducciones: el texto en español es la clave. t("Nueva tarea") devuelve el texto en el
// idioma del usuario; si falta la traducción, el español. Variables con {nombre}:
// t("{n} tareas", { n: 3 }).
import { EN } from "./en";

export type Locale = "es" | "en";
export type Vars = Record<string, string | number>;
export type T = (text: string, vars?: Vars) => string;

export function translate(locale: Locale, text: string, vars?: Vars): string {
  let out = locale === "en" ? (EN[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

export function makeT(locale: Locale): T {
  return (text, vars) => translate(locale, text, vars);
}

/** Locale de Intl para fechas y números. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "es-ES";
}

/** Valor de la base de datos (ES/EN) a Locale. */
export function toLocale(value: string | null | undefined): Locale {
  return value === "EN" || value === "en" ? "en" : "es";
}
