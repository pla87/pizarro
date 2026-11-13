// El editor con barra (TipTap) guarda `<`, `>` y `&` como entidades HTML (`&lt;`, `&gt;`, `&amp;`)
// para que no se confundan con HTML. Pizarro no interpreta HTML en el Markdown, así que se guardan
// los caracteres tal cual los escribió la persona; solo se conserva la entidad donde el carácter
// cambiaría el significado (un `>` al principio de línea sería una cita; `<letra` parecería HTML).

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Todas las entidades a su carácter (para textos planos como la release). */
export function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m, name: string) => ENTITY[name] ?? m);
}

/** Fuera de bloques de código: decodifica salvo donde cambiaría el Markdown. */
function decodeProse(text: string): string {
  return text
    .replace(/&lt;(?![A-Za-z/!?])/g, "<")
    .replace(/(^|\n)([ \t]*(?:[-*+] |\d+[.)] )?)&gt;/g, "$1$2\\>")
    .replace(/&gt;/g, ">")
    .replace(/&amp;(?!#?\w+;)/g, "&");
}

/** Markdown que sale del editor con barra → Markdown con los caracteres reales. */
export function normalizeEditorMarkdown(raw: string): string {
  // Lo que sobra al final: TipTap guarda cada párrafo vacío como «&nbsp;» y un salto de línea como dos espacios; tras pegar
  // queda un párrafo vacío detrás y la descripción se guardaba con «  \n\n\n» o «&nbsp;» al final.
  const md = raw.replace(/(?:\s|&nbsp;)+$/, "");
  if (!md.includes("&")) return md;
  // Bloques ``` y código en línea: el editor no los codifica (TipTap deja el código tal cual), así que se guardan como
  // están. Decodificarlos convertía un `&amp;` o un `&nbsp;` escrito en un fragmento de código en `&` o en un espacio.
  return md
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, i) => (i % 2 === 1 ? part : decodeProse(part)))
    .join("");
}

// Línea «vacía» (opcionalmente dentro de una cita): nada, espacios o el «&nbsp;» con el que TipTap guarda un párrafo vacío.
const EMPTY_LINE = /^((?:[ \t]*>)*)[ \t]*(&nbsp;| )?[ \t]*$/;
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/;

/**
 * Párrafos vacíos del editor con barra en un texto que se va a leer fuera de Pizarro (la release al copiarla o
 * descargarla en .md o .txt, la descripción copiada). TipTap guarda el segundo párrafo vacío seguido y los siguientes
 * como «&nbsp;» (y el primero, como una línea en blanco de más) para no perderlos al volver a abrir el texto; fuera del
 * editor el «&nbsp;» se veía tal cual. Cada serie de líneas en blanco con alguna línea «&nbsp;» pasa a ser una sola línea
 * en blanco (ninguna al principio ni al final del texto); las demás líneas en blanco quedan como estaban, así que un
 * texto sin «&nbsp;» sale idéntico. Con `all`, cualquier serie de varias líneas en blanco se queda en una (para el
 * Markdown recién escrito por el editor, que solo las tiene por párrafos vacíos). Nunca dentro de un bloque de código.
 */
export function blankEmptyParagraphs(md: string, { all = false }: { all?: boolean } = {}): string {
  if (!all && !md.includes("&nbsp;") && !md.includes(" ")) return md;
  const finalNewline = md.endsWith("\n");
  const lines = (finalNewline ? md.slice(0, -1) : md).split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  // Serie de líneas en blanco en curso, con el prefijo de cita («>», «>>»…) que comparten.
  let run: { prefix: string; lines: string[]; nbsp: boolean } | null = null;
  const flush = (atEnd: boolean) => {
    if (!run) return;
    if (!run.nbsp && !(all && run.lines.length > 1)) out.push(...run.lines);
    // Una sola línea en blanco; al principio o al final del texto (fuera de una cita), ninguna.
    else if (run.prefix || (out.length > 0 && !atEnd)) out.push(run.prefix);
    run = null;
  };
  for (const line of lines) {
    if (fence !== null) {
      out.push(line);
      const close = FENCE.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length && line.trimEnd().endsWith(close[1]!)) fence = null;
      continue;
    }
    const empty = EMPTY_LINE.exec(line);
    if (empty) {
      const prefix = empty[1]!.replace(/[ \t]+/g, "");
      if (run && run.prefix !== prefix) flush(false);
      run ??= { prefix, lines: [], nbsp: false };
      run.lines.push(line);
      if (empty[2]) run.nbsp = true;
      continue;
    }
    flush(false);
    const open = FENCE.exec(line);
    if (open) fence = open[1]!;
    out.push(line);
  }
  flush(true);
  return out.join("\n") + (finalNewline ? "\n" : "");
}
