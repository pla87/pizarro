// Texto pegado en «Añadir subtarea» con varias líneas: una subtarea por línea no vacía, sin la viñeta o casilla del
// principio («- », «* », «• », «1. », «2) », «[ ] », «[x] », «- [ ] »…).

/** Viñeta de lista y/o casilla de tarea al principio de una línea. */
const MARKER = /^(?:(?:[-*+•–]|\d{1,4}[.)])\s+)?(?:\[[ xX]?\](?:\s+|$))?/;

/** Recorta a `max` unidades (como cuenta la validación) sin partir un emoji ni otro par sustituto. */
export function clampLength(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

/** Títulos de subtarea de un texto pegado: uno por línea no vacía, sin viñetas y recortados a `maxLength`. */
export function subtaskLines(text: string, maxLength: number): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(MARKER, "").trim())
    // Una viñeta sola («-», «*») o una casilla vacía no son una subtarea.
    .filter((line) => line !== "" && !/^(?:[-*+•–]|\[[ xX]?\])$/.test(line))
    .map((line) => clampLength(line, maxLength));
}

/**
 * Lo que se envía de un pegado de muchas líneas (como mucho `max`, lo que admite el servidor) y cuántas se quedan fuera
 * sin enviar: se suman a las que el servidor no pudo añadir para que el aviso diga cuántas faltan en total.
 */
export function subtaskBatch(lines: readonly string[], max: number): { send: string[]; dropped: number } {
  return { send: lines.slice(0, max), dropped: Math.max(0, lines.length - max) };
}
