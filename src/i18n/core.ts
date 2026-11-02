// Traducciones: el texto en español es la clave. t("Nueva tarea") devuelve el texto en el
// idioma del usuario; si falta la traducción, el español. Variables con {nombre}:
// t("{n} tareas", { n: 3 }).
//
// Este módulo incluye el diccionario de inglés: es para el servidor (páginas, acciones, emails, informes) y las
// pruebas, que lo necesitan siempre. Los módulos que acaban en el navegador no deben importarlo: usan ./shared
// (esT) o el contexto de ./client, que carga el diccionario solo cuando el idioma es inglés.
import { EN } from "./en";
import { makeTWith, translateWith, type Locale, type T, type Vars } from "./shared";

export { intlLocale, toLocale } from "./shared";
export type { Locale, T, Vars } from "./shared";

export function translate(locale: Locale, text: string, vars?: Vars): string {
  return translateWith(locale === "en" ? EN : undefined, text, vars);
}

export function makeT(locale: Locale): T {
  return makeTWith(locale === "en" ? EN : undefined);
}
