// Mensajes con datos que se guardan en español (errores de las copias de seguridad y de la configuración: estado de las
// copias, JobRun.lastError, Logs) y se traducen al leerlos: la plantilla es una clave del diccionario y log-legacy.ts la
// reconoce por su texto fijo (storedText). `npm run i18n:check` comprueba que cada plantilla que recibe esText tiene
// traducción. Sin el diccionario de inglés: también lo usan los scripts de línea de órdenes.
import { esT, type Vars } from "../i18n/shared";

export function esText(template: string, vars: Vars): string {
  return esT(template, vars);
}
