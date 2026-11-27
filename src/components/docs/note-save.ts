// Reglas del guardado automático de una nota (NoteEditor), sin React: cuánto esperar y cuándo dejar de intentarlo.

import { NOTE_MAX_CHARS } from "@/lib/document-kind";

/**
 * Espera tras dejar de escribir antes de guardar: cada guardado manda el texto entero y reescribe la fila, así que una
 * nota grande espera más (1,2 s hasta 20.000 caracteres, 3 s hasta 100.000 y 5 s más allá). Cerrar el visor, pulsar
 * «Listo» u ocultar la pestaña guardan sin esperar.
 */
export function noteSaveDelay(chars: number): number {
  return chars <= 20_000 ? 1200 : chars <= 100_000 ? 3000 : 5000;
}

/** Espera para copiar lo escrito al borrador local (cada copia serializa el texto entero). */
export const NOTE_DRAFT_DELAY_MS = 300;

/**
 * Por qué se dejó de guardar solo: la nota está en la papelera, no cabe en la cuota o pasa del máximo de caracteres.
 * Reintentar en cada pausa no lo arregla (y cada fallo queda en Logs).
 */
export type NoteSaveStop = { reason: "trashed" } | { reason: "quota"; chars: number } | { reason: "too_long" };

/** El error de un guardado (su `code`) que no se arregla solo, o null si vale la pena reintentar. */
export function noteSaveStop(code: string | undefined, chars: number): NoteSaveStop | null {
  if (code === "note_trashed") return { reason: "trashed" };
  if (code === "note_too_long") return { reason: "too_long" };
  if (code === "quota_project" || code === "quota_total" || code === "quota") return { reason: "quota", chars };
  return null;
}

/**
 * ¿Sigue parado el guardado con este texto? Pasar del máximo se arregla quitando texto; la cuota, con un texto más corto
 * que el que no cupo (o pulsando «Reintentar»). La papelera, nunca desde el editor.
 */
export function noteStillStopped(stop: NoteSaveStop, text: string): boolean {
  if (stop.reason === "too_long") return text.length > NOTE_MAX_CHARS;
  if (stop.reason === "quota") return text.length >= stop.chars;
  return true;
}
