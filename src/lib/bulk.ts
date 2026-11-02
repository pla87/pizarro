// Alta en bloque: convierte un texto pegado en títulos de tarea (una por línea).
import { MAX_TITLE } from "./constants";
import { clampTitle } from "./title-clamp";

export const MAX_BULK_TASKS = 100;

// Viñetas y casillas habituales al principio de la línea: "-", "*", "•", "1.", "2)", "[ ]", "- [x]".
const BULLET_RE = /^\s*(?:[-*•·–—+]\s+|\d{1,3}[.)]\s+)?(?:\[[ xX]?\]\s*)?/;

/** Líneas del texto pegado como títulos; las que superan el máximo se recortan (sin partir emojis) y se cuentan en `clipped`. */
export function parseTaskLinesInfo(text: string): { lines: string[]; clipped: number } {
  let clipped = 0;
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(BULLET_RE, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const c = clampTitle(line, MAX_TITLE);
      if (c.clipped) clipped++;
      return c.value;
    });
  return { lines, clipped };
}

export function parseTaskLines(text: string): string[] {
  return parseTaskLinesInfo(text).lines;
}
