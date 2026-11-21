// Resaltar lo buscado (histórico de releases): dónde aparece una búsqueda en un texto con la misma regla que la búsqueda
// (sin distinguir mayúsculas ni tildes, search-accents.ts), con las posiciones del texto original para envolverlas en
// <mark>. Funciones puras, sin dependencias: valen en el navegador y en las pruebas.

/** Clase de cada coincidencia resaltada (globals.css: se lee en claro y en oscuro). */
export const SEARCH_HIT_CLASS = "search-hit";

/** Carácter que separa dos bloques del Markdown en el texto plegado: una búsqueda no lo contiene (el servidor quita el NUL). */
const BLOCK_GAP = "\u0000";

const foldCache = new Map<string, string>();
/** Un carácter (punto de código) fuera de ASCII en minúsculas y sin marcas diacríticas; las marcas sueltas quedan en "". */
function foldChar(ch: string): string {
  let folded = foldCache.get(ch);
  if (folded === undefined) {
    folded = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (foldCache.size < 4096) foldCache.set(ch, folded);
  }
  return folded;
}

/**
 * El texto plegado (minúsculas, sin tildes: como normalizeSearch, carácter a carácter) y, por cada unidad del plegado,
 * dónde empieza y dónde acaba en el original el carácter del que sale. Una marca combinante suelta («e» + U+0301) no deja
 * nada en el plegado y alarga el final del carácter anterior: el resaltado la incluye.
 */
function foldWithMap(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const f = len === 1 && cp < 128 ? (cp >= 65 && cp <= 90 ? String.fromCharCode(cp + 32) : text[i]!) : foldChar(text.slice(i, i + len));
    if (f.length === 0) {
      if (ends.length) ends[ends.length - 1] = i + len;
    } else {
      folded += f;
      for (let k = 0; k < f.length; k++) {
        starts.push(i);
        ends.push(i + len);
      }
    }
    i += len;
  }
  return { folded, starts, ends };
}

/** Lo buscado, plegado como el texto (vacío si no queda nada que buscar). */
export function foldQuery(query: string): string {
  return foldWithMap(query.trim()).folded;
}

/** Coincidencias (sin solaparse, de izquierda a derecha) de `needle` ya plegado en `folded`: [inicio, fin) del plegado. */
function foldedMatches(folded: string, needle: string): [number, number][] {
  const out: [number, number][] = [];
  if (!needle) return out;
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
  return out;
}

/**
 * Tramos [inicio, fin) del texto original donde aparece la búsqueda, sin distinguir mayúsculas ni tildes: «desplegable»
 * encuentra «Desplegable» y «despleGáble». Sin búsqueda, ninguno.
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const needle = foldQuery(query);
  if (!needle || !text) return [];
  const { folded, starts, ends } = foldWithMap(text);
  return foldedMatches(folded, needle).map(([a, b]) => [starts[a]!, ends[b - 1]!]);
}

/** El texto en trozos: los que coinciden con la búsqueda llevan `hit`. Sin coincidencias, un solo trozo. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const [a, b] of highlightRanges(text, query)) {
    if (a > last) parts.push({ text: text.slice(last, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    last = b;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Elementos en línea: una coincidencia puede seguir de uno a otro («foo **bar**»). Los demás (párrafos, puntos de lista,
 * celdas, saltos de línea, imágenes…) separan: una búsqueda no los atraviesa.
 */
const INLINE = new Set(["a", "abbr", "b", "code", "del", "em", "i", "kbd", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "u"]);

/**
 * Plugin de rehype (Markdown.tsx): envuelve en <mark class="search-hit"> lo que coincide con `query` en los nodos de texto
 * del Markdown ya interpretado, nunca en el texto crudo (no rompe la sintaxis ni los enlaces: la marca va dentro del <a>).
 * Una coincidencia que cruza un elemento en línea (negrita, enlace) se marca a trozos, uno por nodo. Una sola pasada por
 * el árbol y un solo indexOf sobre todo el texto: con cientos de coincidencias (una release de 300 tareas) sigue siendo
 * lineal.
 */
export function rehypeSearchHighlight(query: string) {
  const needle = foldQuery(query);
  return (tree: HastNode) => {
    if (!needle) return;
    const segments: { parent: HastNode; node: HastNode; offset: number; starts: number[]; ends: number[] }[] = [];
    const chunks: string[] = [];
    let length = 0;
    const gap = () => {
      if (chunks.at(-1) !== BLOCK_GAP) {
        chunks.push(BLOCK_GAP);
        length += 1;
      }
    };
    const walk = (node: HastNode) => {
      for (const child of node.children ?? []) {
        if (child.type === "text" && child.value) {
          const { folded, starts, ends } = foldWithMap(child.value);
          segments.push({ parent: node, node: child, offset: length, starts, ends });
          chunks.push(folded);
          length += folded.length;
        } else if (child.type === "element") {
          const inline = INLINE.has(child.tagName ?? "");
          if (!inline) gap();
          walk(child);
          if (!inline) gap();
        }
      }
    };
    walk(tree);
    const matches = foldedMatches(chunks.join(""), needle);
    if (!matches.length) return;
    // Tramos del original por nodo de texto (las coincidencias y los nodos van en el mismo orden: un solo recorrido).
    const pieces = new Map<HastNode, [number, number][]>();
    let m = 0;
    for (const seg of segments) {
      const end = seg.offset + seg.starts.length;
      while (m < matches.length && matches[m]![1] <= seg.offset) m++;
      for (let k = m; k < matches.length && matches[k]![0] < end; k++) {
        const a = Math.max(matches[k]![0], seg.offset) - seg.offset;
        const b = Math.min(matches[k]![1], end) - seg.offset;
        if (b <= a) continue;
        const list = pieces.get(seg.node) ?? [];
        list.push([seg.starts[a]!, seg.ends[b - 1]!]);
        pieces.set(seg.node, list);
      }
    }
    const replaced = new Map<HastNode, HastNode[]>();
    for (const seg of segments) {
      const ranges = pieces.get(seg.node);
      if (!ranges) continue;
      const value = seg.node.value!;
      const out: HastNode[] = [];
      let last = 0;
      for (const [a, b] of ranges) {
        if (a > last) out.push({ type: "text", value: value.slice(last, a) });
        out.push({ type: "element", tagName: "mark", properties: { className: [SEARCH_HIT_CLASS] }, children: [{ type: "text", value: value.slice(a, b) }] });
        last = b;
      }
      if (last < value.length) out.push({ type: "text", value: value.slice(last) });
      replaced.set(seg.node, out);
    }
    const parents = new Set(segments.filter((s) => replaced.has(s.node)).map((s) => s.parent));
    for (const parent of parents) parent.children = parent.children!.flatMap((c) => replaced.get(c) ?? [c]);
  };
}
