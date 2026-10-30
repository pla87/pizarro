// Edición de Markdown en el textarea (modo «Markdown»): sangría de listas y atajos de formato.
// Funciones puras: reciben el texto y la selección y devuelven el texto nuevo con la selección resultante.

export interface EditResult {
  value: string;
  /** Selección tras la edición. */
  start: number;
  end: number;
}

interface Line {
  from: number;
  /** Fin de la línea, sin el salto. */
  to: number;
  text: string;
}

/** Marcador de lista al principio de una línea: «- », «* », «+ », «1. », «1) », con casilla opcional («- [ ] »). */
const LIST_RE = /^(\s*)((?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)/;

function linesOf(value: string): Line[] {
  const out: Line[] = [];
  let from = 0;
  for (const text of value.split("\n")) {
    out.push({ from, to: from + text.length, text });
    from += text.length + 1;
  }
  return out;
}

/** Índices de la primera y la última línea que toca la selección (una selección que acaba justo al empezar una línea no la incluye). */
function lineRange(lines: Line[], start: number, end: number): [number, number] {
  let first = 0;
  let last = 0;
  lines.forEach((l, i) => {
    if (start >= l.from) first = i;
    if (end >= l.from) last = i;
  });
  if (end > start && last > first && end === lines[last]!.from) last -= 1;
  return [first, last];
}

interface Edit {
  /** Posición del texto original donde se edita. */
  at: number;
  /** Caracteres que se quitan desde `at`. */
  remove: number;
  insert: string;
}

/** Aplica ediciones (ordenadas y sin solaparse) y lleva la selección con el texto. */
function applyEdits(value: string, edits: Edit[], start: number, end: number): EditResult {
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += value.slice(cursor, e.at) + e.insert;
    cursor = e.at + e.remove;
  }
  out += value.slice(cursor);
  const map = (pos: number) => {
    let acc = 0;
    for (const e of edits) {
      if (pos < e.at) break;
      if (pos >= e.at + e.remove) acc += e.insert.length - e.remove;
      else return e.at + acc + e.insert.length;
    }
    return pos + acc;
  };
  return { value: out, start: map(start), end: map(end) };
}

const indentOf = (text: string) => /^ */.exec(text)![0].length;

/** Marcador de lista de una línea (sangría y anchura del marcador), o null. */
export function listMarker(text: string): { indent: number; width: number } | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  // El contenido de un elemento empieza tras «1. » o «- »; la casilla «[ ] » no cuenta para anidar (basta el marcador).
  const marker = /^(?:[-*+]|\d{1,9}[.)])\s+/.exec(m[2]!)![0];
  return { indent: m[1]!.length, width: marker.length };
}

/** Línea de lista anterior más cercana (sin saltar texto que no sea de la lista), o null. */
function previousListLine(lines: Line[], index: number, accept: (indent: number) => boolean): { indent: number; width: number } | null {
  for (let i = index - 1; i >= 0; i--) {
    const text = lines[i]!.text;
    if (text.trim() === "") continue;
    const marker = listMarker(text);
    if (marker) {
      if (accept(marker.indent)) return marker;
      continue;
    }
    // Texto de continuación (sangrado): sigue dentro de la lista. Una línea sin sangría que no es de lista la corta.
    if (indentOf(text) === 0) return null;
  }
  return null;
}

/** Cuántos espacios añadir (>0) o quitar (<0) a la línea `index` al sangrarla o desangrarla; 0 si no se puede. */
export function indentDelta(value: string, index: number, direction: 1 | -1): number {
  const lines = linesOf(value);
  const line = lines[index];
  if (!line) return 0;
  const marker = listMarker(line.text);
  if (!marker) return 0;
  if (direction === 1) {
    // Se anida bajo el hermano anterior: solo si ese está al mismo nivel (si es el padre, ya es su primer hijo).
    const prev = previousListLine(lines, index, (indent) => indent <= marker.indent);
    return prev && prev.indent === marker.indent ? prev.width : 0;
  }
  if (marker.indent === 0) return 0;
  const parent = previousListLine(lines, index, (indent) => indent < marker.indent);
  return -(marker.indent - (parent?.indent ?? 0));
}

/**
 * Sangra (`direction` 1) o desangra (-1) las líneas de lista tocadas por la selección. El desplazamiento lo decide la
 * primera línea de lista movible y se aplica igual a las demás, para conservar su estructura. Devuelve null si no hay nada que mover
 * (no es una lista o ya está en el nivel máximo/mínimo): quien llama deja entonces actuar a Tab (mover el foco).
 */
export function indentLines(value: string, start: number, end: number, direction: 1 | -1): EditResult | null {
  const lines = linesOf(value);
  const [first, last] = lineRange(lines, start, end);
  // Manda la primera línea de lista que se pueda mover (la primera de una lista no se puede sangrar, pero sí las de debajo).
  let source = -1;
  let delta = 0;
  for (let i = first; i <= last && delta === 0; i++) {
    delta = indentDelta(value, i, direction);
    source = i;
  }
  if (delta === 0) return null;
  const edits: Edit[] = [];
  for (let i = source; i <= last; i++) {
    const l = lines[i]!;
    if (!listMarker(l.text)) continue;
    if (delta > 0) edits.push({ at: l.from, remove: 0, insert: " ".repeat(delta) });
    else if (indentOf(l.text) > 0) edits.push({ at: l.from, remove: Math.min(-delta, indentOf(l.text)), insert: "" });
  }
  return applyEdits(value, edits, start, end);
}

/** Envuelve la selección con `before`/`after` (la quita si ya está envuelta). Sin selección, deja el cursor entre ambos. */
export function toggleWrap(value: string, start: number, end: number, before: string, after: string = before, placeholder = ""): EditResult {
  const selected = value.slice(start, end);
  const around = value.slice(Math.max(0, start - before.length), start) === before && value.slice(end, end + after.length) === after;
  if (around && start >= before.length) {
    return { value: value.slice(0, start - before.length) + selected + value.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  const text = selected || placeholder;
  const next = value.slice(0, start) + before + text + after + value.slice(end);
  return { value: next, start: start + before.length, end: start + before.length + text.length };
}

export type LineFormat = "ul" | "ol" | "task" | "quote" | "h2" | "h3";

const PREFIX_RE = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+|>\s?|#{1,6}\s+)/;

function prefixFor(kind: LineFormat, n: number): string {
  return { ul: "- ", ol: `${n}. `, task: "- [ ] ", quote: "> ", h2: "## ", h3: "### " }[kind];
}

/** Aplica (o quita, si todas ya lo tienen) un prefijo de línea: lista, numerada, casillas, cita o título. Sustituye a otro prefijo. */
export function toggleLinePrefix(value: string, start: number, end: number, kind: LineFormat): EditResult {
  const lines = linesOf(value);
  const [first, last] = lineRange(lines, start, end);
  const target = lines.slice(first, last + 1);
  const markerOf = (l: Line) => {
    const m = PREFIX_RE.exec(l.text);
    return m ? { indent: m[1]!.length, marker: l.text.slice(m[1]!.length, m[0].length) } : null;
  };
  const has = (l: Line) => {
    const m = markerOf(l);
    if (!m) return false;
    return m.marker === prefixFor(kind, 1) || (kind === "ol" && /^\d+[.)]\s+$/.test(m.marker)) || (kind === "ul" && /^[-*+]\s+$/.test(m.marker));
  };
  const filled = target.filter((l) => l.text.trim() !== "");
  const remove = filled.length > 0 && filled.every(has);
  const edits: Edit[] = [];
  let n = 0;
  for (const l of target) {
    // En una selección de varias líneas se saltan las vacías; una sola línea vacía sí recibe el prefijo.
    if (l.text.trim() === "" && target.length > 1) continue;
    n += 1;
    const m = markerOf(l);
    const indent = m ? m.indent : indentOf(l.text);
    edits.push({ at: l.from + indent, remove: m ? m.marker.length : 0, insert: remove ? "" : prefixFor(kind, n) });
  }
  return applyEdits(value, edits, start, end);
}

/** Bloque de código con vallas ``` alrededor de la selección (o de la línea actual); si ya lo está, quita las vallas. */
export function toggleCodeBlock(value: string, start: number, end: number): EditResult {
  const lines = linesOf(value);
  const [first, last] = lineRange(lines, start, end);
  const above = lines[first - 1]?.text.trim();
  const below = lines[last + 1]?.text.trim();
  if (first > 0 && above?.startsWith("```") && below === "```") {
    const from = lines[first - 1]!.from;
    const body = value.slice(lines[first]!.from, lines[last]!.to);
    const next = value.slice(0, from) + body + value.slice(lines[last + 1]!.to);
    const shift = lines[first]!.from - from;
    return { value: next, start: Math.max(from, start - shift), end: Math.max(from, end - shift) };
  }
  const from = lines[first]!.from;
  const to = lines[last]!.to;
  const body = value.slice(from, to);
  const next = value.slice(0, from) + "```\n" + body + "\n```" + value.slice(to);
  return { value: next, start: start + 4, end: end + 4 };
}

/** Inserta una regla horizontal (---) en su propio bloque tras la línea actual, con el cursor debajo. */
export function insertRule(value: string, start: number, end: number): EditResult {
  const lines = linesOf(value);
  const [, last] = lineRange(lines, start, end);
  const at = lines[last]!.to;
  const head = value.slice(0, at);
  const rest = value.slice(at).replace(/^\n+/, "");
  const insert = `${head.trim() === "" ? "" : "\n\n"}---\n\n`;
  return { value: head + insert + rest, start: at + insert.length, end: at + insert.length };
}

/** Enlace [texto](https://): la selección pasa a ser el texto y queda seleccionada la dirección para pegarla. */
export function insertLink(value: string, start: number, end: number): EditResult {
  const selected = value.slice(start, end);
  const isUrl = /^https?:\/\/\S+$/i.test(selected);
  const text = isUrl ? "texto" : selected || "texto";
  const url = isUrl ? selected : "https://";
  const next = value.slice(0, start) + `[${text}](${url})` + value.slice(end);
  const urlStart = start + text.length + 3;
  return { value: next, start: isUrl ? start + 1 : urlStart, end: isUrl ? start + 1 + text.length : urlStart + url.length };
}
