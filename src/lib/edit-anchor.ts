/**
 * Punto del texto en el que se hizo doble clic para editar (la descripción del detalle): al pasar de la vista de lectura al
 * editor, el cursor va a ese punto y el texto bajo el ratón se queda donde estaba. La vista de lectura y el editor no tienen
 * el mismo texto (en el de Markdown se ven las marcas, `**`, `- `…), así que el punto se busca por el texto de alrededor.
 */
export interface EditAnchor {
  /** Texto visible justo antes y justo después del punto. */
  before: string;
  after: string;
  /** Posición del punto en el texto visible, de 0 a 1 (para elegir entre varias apariciones del mismo texto). */
  ratio: number;
  /** Altura (en la ventana) a la que estaba el punto: el cursor del editor se deja a esa misma altura. */
  top: number;
}

/** Caracteres de contexto a cada lado del punto. */
export const ANCHOR_CONTEXT = 32;

/**
 * Posición en `text` que corresponde al ancla: se busca el contexto más largo que aparezca (primero los dos lados; si no,
 * trozos más cortos de cada lado, porque las marcas de Markdown o el salto entre párrafos lo cortan) y, entre varias
 * apariciones, la más cercana a la proporción. Si no aparece nada, la proporción.
 */
export function anchorIndex(text: string, a: Pick<EditAnchor, "before" | "after" | "ratio">): number {
  const guess = Math.round(Math.min(1, Math.max(0, a.ratio)) * text.length);
  const tries: [string, string][] = [
    [a.before, a.after],
    [a.before.slice(-12), a.after.slice(0, 12)],
    [a.before.slice(-12), ""],
    ["", a.after.slice(0, 12)],
    [a.before.slice(-5), ""],
    ["", a.after.slice(0, 5)],
  ];
  for (const [b, f] of tries) {
    const needle = b + f;
    if (!needle.trim()) continue;
    let best = -1;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      const at = i + b.length;
      if (best < 0 || Math.abs(at - guess) < Math.abs(best - guess)) best = at;
    }
    if (best >= 0) return best;
  }
  return guess;
}
