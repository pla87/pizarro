// Alta en bloque: convierte un texto pegado en títulos de tarea (una por línea).
import { MAX_TITLE } from "./constants";

export const MAX_BULK_TASKS = 100;

// Viñetas y casillas habituales al principio de la línea: "-", "*", "•", "1.", "2)", "[ ]", "- [x]".
const BULLET_RE = /^\s*(?:[-*•·–—+]\s+|\d{1,3}[.)]\s+)?(?:\[[ xX]?\]\s*)?/;

export function parseTaskLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(BULLET_RE, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE))
    .filter((line) => line.length > 0);
}
