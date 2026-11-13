import { Lexer, type Token } from "marked";

// Markdown de un texto largo editado con el editor con barra (la release): el editor guarda el documento entero con su
// propio formato (sin `# `, que no admite; enlaces sin `<…>`; la descripción sangrada de una tarea, sin sangría; `_x_` como
// `*x*`…). Para que editar una línea no reescriba todo lo demás, los bloques que la persona no ha tocado conservan el
// texto exacto que tenían; solo los editados salen como los escribe el editor.
//
// Unidades: cada bloque de primer nivel (párrafo, título, cita, código, tabla…) y, en las listas, cada elemento (con lo
// que cuelga de él). Una unidad del texto de partida está «intacta» si el editor la escribe tal cual aparece en su salida.
// Se alinean las dos secuencias (prefijo y sufijo comunes y, en medio, la subsecuencia común más larga) y se rehace el
// texto: unidades intactas con su texto y separadores originales; el resto, como sale del editor.

interface Unit {
  start: number;
  /** Sin los espacios y saltos del final (son separador). */
  end: number;
  /** Viñeta o tipo de numeración de un elemento de lista («-», «*», «1.», «1)»); null fuera de una lista. */
  marker: string | null;
}

const MAX_LCS_CELLS = 400_000;

function markerOf(text: string): string {
  const m = /^\s*(?:([-*+])|\d+([.)]))/.exec(text);
  return m ? (m[1] ?? `1${m[2]}`) : "";
}

/** Unidades del texto en orden, o null si el lexer no cuadra con el texto (entonces no se intenta conservar nada). */
function unitsOf(src: string): Unit[] | null {
  let tokens: Token[];
  try {
    tokens = new Lexer({ gfm: true }).lex(src);
  } catch {
    return null;
  }
  const out: Unit[] = [];
  let pos = 0;
  const push = (start: number, raw: string, marker: string | null) => {
    const end = start + raw.trimEnd().length;
    if (end > start) out.push({ start, end, marker });
  };
  for (const tok of tokens) {
    if (!src.startsWith(tok.raw, pos)) return null;
    if (tok.type === "list" && "items" in tok) {
      let p = pos;
      const items = tok.items as { raw: string }[];
      const fits = items.every((item) => {
        if (!src.startsWith(item.raw, p)) return false;
        p += item.raw.length;
        return true;
      }) && p <= pos + tok.raw.length;
      if (fits) {
        p = pos;
        for (const item of items) {
          push(p, item.raw, markerOf(item.raw));
          p += item.raw.length;
        }
      } else push(pos, tok.raw, null);
    } else if (tok.type !== "space") push(pos, tok.raw, null);
    pos += tok.raw.length;
  }
  return pos === src.length ? out : null;
}

/** Texto de cada unidad (para preparar de antemano, en ratos libres, lo que `normalize` recuerda). */
export function markdownUnits(src: string): string[] {
  return (unitsOf(src) ?? []).map((u) => src.slice(u.start, u.end));
}

/** Pares (unidad del original → unidad editada) de la alineación; -1 = editada. */
function align(baseKeys: string[], editedKeys: string[]): Int32Array {
  const match = new Int32Array(editedKeys.length).fill(-1);
  const n = baseKeys.length, m = editedKeys.length;
  let pre = 0;
  while (pre < n && pre < m && baseKeys[pre] === editedKeys[pre]) match[pre] = pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && baseKeys[n - 1 - suf] === editedKeys[m - 1 - suf]) {
    match[m - 1 - suf] = n - 1 - suf;
    suf++;
  }
  const bn = n - pre - suf, em = m - pre - suf;
  if (!bn || !em || (bn + 1) * (em + 1) > MAX_LCS_CELLS) return match;
  // Subsecuencia común más larga del tramo central (normalmente unas pocas unidades: lo que se ha tocado).
  const w = em + 1;
  const dp = new Int32Array((bn + 1) * w);
  for (let i = bn - 1; i >= 0; i--) {
    for (let j = em - 1; j >= 0; j--) {
      dp[i * w + j] = baseKeys[pre + i] === editedKeys[pre + j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  for (let i = 0, j = 0; i < bn && j < em; ) {
    if (baseKeys[pre + i] === editedKeys[pre + j]) {
      match[pre + j] = pre + i;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return match;
}

/**
 * Texto final de `edited` (Markdown que sale del editor) conservando el de `base` (el texto que se cargó en el editor) en
 * las unidades que no se han tocado. `normalize` da cómo escribe el editor un trozo de Markdown (ida y vuelta por él).
 * Si no se ha tocado nada, devuelve `base` tal cual. Ante cualquier cosa rara, `edited` (correcto, aunque reformateado).
 */
export function keepUntouchedMarkdown(base: string, edited: string, normalize: (md: string) => string): string {
  const b = unitsOf(base);
  const e = unitsOf(edited);
  if (!b || !e || !e.length) return edited;
  const text = (src: string, u: Unit) => src.slice(u.start, u.end);
  const baseKeys = b.map((u) => normalize(text(base, u)).trim());
  const editedKeys = e.map((u) => text(edited, u).trim());
  const match = align(baseKeys, editedKeys);
  // Un elemento de lista solo conserva su texto si lleva la misma viñeta que la lista editada: «* a» entre elementos
  // «- b» empezaría otra lista.
  for (let j = 0; j < e.length; j++) {
    const i = match[j]!;
    if (i >= 0 && b[i]!.marker !== e[j]!.marker && b[i]!.marker !== null && e[j]!.marker !== null) match[j] = -1;
  }
  const kept = new Set<number>();
  for (const i of match) if (i >= 0) kept.add(i);
  // ¿La unidad editada `e[j]` ocupa el sitio de la original `b[i]` (no conservada, del mismo tipo: elemento de lista con
  // la misma viñeta, o bloque)? Entonces se separa de su vecina con el separador original («### Tipo» seguido de su
  // lista sin línea en blanco). Si el tipo cambia, el separador del editor: un párrafo pegado a una lista sería parte de ella.
  const replaces = (j: number, i: number) => i >= 0 && i < b.length && !kept.has(i) && b[i]!.marker === e[j]!.marker;
  const baseSep = (i: number) => base.slice(b[i]!.end, b[i + 1]!.start);
  let out = "";
  for (let j = 0; j < e.length; j++) {
    const i = match[j]!;
    if (j === 0) out += i === 0 ? base.slice(0, b[0]!.start) : edited.slice(0, e[0]!.start);
    else {
      const prev = match[j - 1]!;
      if (prev >= 0 && i === prev + 1) out += baseSep(prev);
      else if (prev >= 0 && i < 0 && replaces(j, prev + 1)) out += baseSep(prev);
      else if (prev < 0 && i > 0 && replaces(j - 1, i - 1)) out += baseSep(i - 1);
      else out += edited.slice(e[j - 1]!.end, e[j]!.start);
    }
    out += i >= 0 ? text(base, b[i]!) : text(edited, e[j]!);
  }
  const last = match[e.length - 1]!;
  out += b.length && last === b.length - 1 ? base.slice(b[last]!.end) : edited.slice(e[e.length - 1]!.end);
  if (base.endsWith("\n") && !out.endsWith("\n")) out += "\n";
  return out;
}
