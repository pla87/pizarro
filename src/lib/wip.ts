// Límite orientativo de tarjetas por columna (WIP). Solo avisa: nunca impide mover ni crear tarjetas.

export const WIP_MIN = 1;
export const WIP_MAX = 999;

/** ¿Es un límite válido (entero de 1 a 999)? */
export function isValidWipLimit(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= WIP_MIN && n <= WIP_MAX;
}

/**
 * ¿La columna pasa de su límite? Solo con MÁS tarjetas (no archivadas) que el límite: con las justas
 * (n = límite) todavía no se avisa. Sin límite (null/undefined) nunca.
 */
export function wipExceeded(count: number, limit: number | null | undefined): boolean {
  return limit != null && count > limit;
}

/**
 * Interpreta lo que se escribe en el cuadro del límite: vacío = sin límite (null); un entero de 1 a 999 = ese límite;
 * cualquier otra cosa = `undefined` (no válido).
 */
export function parseWipInput(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d{1,4}$/.test(s)) return undefined;
  const n = Number(s);
  return isValidWipLimit(n) ? n : undefined;
}
