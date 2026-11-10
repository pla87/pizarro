// Tablas pegadas como HTML (Word, Google Docs, Excel, una web) → tabla Markdown (GFM). Sin DOM, para poder probarlo:
// un lector de etiquetas tolerante basta para tablas (el HTML del portapapeles viene muy sucio: mso-*, <o:p>,
// comentarios condicionales de Office, atributos sin comillas).
//
// Fuera de las tablas, el HTML pegado no se toca: el editor lo sigue interpretando como siempre.

/** Etiquetas sin cierre. */
const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "wbr", "col", "area", "base", "source", "embed", "param", "track"]);
/** Contenido que no se lee nunca. */
const RAW = new Set(["style", "script", "title", "xml", "template", "noscript", "head"]);
/** Bloques: dentro de una celda separan el texto (como un salto de línea). */
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "header", "footer", "table", "tr", "caption", "figure", "figcaption", "address", "center"]);

/** Tope de celdas combinadas (un colspan/rowspan disparatado no debe colgar la página). */
const MAX_SPAN = 100;
/** Tope de celdas de la rejilla de una tabla (con las combinadas ya repartidas): más grande, se pega como antes. */
export const MAX_TABLE_CELLS = 50_000;
/** Tope del HTML pegado que se mira en busca de tablas: más grande, se pega como antes, sin convertir nada. */
export const MAX_TABLE_HTML = 2 * 1024 * 1024;

type Token =
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean; start: number; end: number }
  | { kind: "close"; name: string; start: number; end: number }
  | { kind: "text"; text: string; start: number; end: number };

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
  euro: "€", deg: "°", times: "×", divide: "÷", iexcl: "¡", iquest: "¿", aacute: "á", eacute: "é", iacute: "í",
  oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ",
  uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç", ordm: "º", ordf: "ª", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

/**
 * Etiqueta de apertura o cierre en una posición dada (los atributos entre comillas pueden llevar «>»). Fuera de las
 * comillas no admite «<»: si no, cada «<» sin cerrar recorrería el resto del texto (tiempo cuadrático).
 */
const TAG = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'"<>])*)>/y;

/** Etiquetas, textos y sus posiciones. Sin comentarios ni contenido de <style>/<script>. */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let text = 0;
  const flush = (end: number) => {
    if (end > text) tokens.push({ kind: "text", text: decodeEntities(html.slice(text, end)), start: text, end });
  };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      flush(lt);
      const close = html.indexOf("-->", lt + 4);
      i = text = close < 0 ? html.length : close + 3;
      continue;
    }
    // <!DOCTYPE>, <![if …]> / <![endif]> de Office, <?xml?>.
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      flush(lt);
      const close = html.indexOf(">", lt);
      i = text = close < 0 ? html.length : close + 1;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(html);
    if (!m) {
      i = lt + 1;
      continue;
    }
    flush(lt);
    const name = m[2]!.toLowerCase();
    const end = lt + m[0].length;
    if (m[1]) tokens.push({ kind: "close", name, start: lt, end });
    else {
      const selfClosing = /\/\s*$/.test(m[3]!);
      tokens.push({ kind: "open", name, attrs: parseAttrs(m[3]!.replace(/\/\s*$/, "")), selfClosing, start: lt, end });
      if (RAW.has(name) && !selfClosing) {
        const close = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(end));
        const after = close ? end + close.index + close[0].length : html.length;
        tokens.push({ kind: "close", name, start: after, end: after });
        i = text = after;
        continue;
      }
    }
    i = text = end;
  }
  flush(html.length);
  return tokens;
}

// ---------------------------------------------------------------- celdas

interface Format {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}
interface Run extends Format {
  text: string;
}
/** Un salto dentro de la celda (<br>, párrafo): se pinta como espacio (GFM no admite saltos en una celda). */
const BREAK: Run = { text: "\n" };

function styleOf(attrs: Record<string, string>): string {
  return (attrs.style ?? "").toLowerCase();
}

/** Lo que una etiqueta aporta al formato (undefined = no cambia). */
function formatOf(name: string, attrs: Record<string, string>): Format {
  const style = styleOf(attrs);
  const f: Format = {};
  if (name === "b" || name === "strong") f.bold = true;
  if (name === "i" || name === "em" || name === "cite") f.italic = true;
  if (name === "s" || name === "strike" || name === "del") f.strike = true;
  if (name === "code" || name === "kbd" || name === "samp" || name === "tt") f.code = true;
  const weight = /(?:^|;)\s*font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
  // Google Docs envuelve todo en <b style="font-weight:normal">: eso no es negrita.
  if (weight) f.bold = weight === "bold" || weight === "bolder" || (/^\d+$/.test(weight) && Number(weight) >= 600);
  const fontStyle = /(?:^|;)\s*font-style\s*:\s*([a-z]+)/.exec(style)?.[1];
  if (fontStyle) f.italic = fontStyle === "italic" || fontStyle === "oblique";
  if (/text-decoration[^;]*line-through/.test(style)) f.strike = true;
  if (name === "a") {
    const href = (attrs.href ?? "").trim();
    // Solo direcciones absolutas seguras: una relativa de la web de origen no llevaría a ningún sitio aquí.
    if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) f.href = href;
  }
  return f;
}

/** Elementos que no se ven: viñetas generadas por Word (mso-list:Ignore) y lo oculto. */
function hidden(attrs: Record<string, string>): boolean {
  const style = styleOf(attrs);
  return /mso-list\s*:\s*ignore/.test(style) || /display\s*:\s*none/.test(style) || /mso-hide\s*:\s*all/.test(style);
}

const sameFormat = (a: Format, b: Format) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && (a.href ?? "") === (b.href ?? "");

/** Escapa lo que en una celda se leería como Markdown en línea (y «|», que partiría la celda). */
export function escapeCellText(s: string): string {
  return s
    .replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\")
    .replace(/[*`[\]<|~]/g, "\\$&")
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_")
    .replace(/&(?=#?\w+;)/g, "\\&");
}

/** Texto con su formato: los espacios de los bordes quedan fuera de las marcas («** x**» no sería negrita). */
function wrap(text: string, f: Format): string {
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text.slice(lead.length))![0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  let out: string;
  if (f.code && !core.includes("`")) out = "`" + core.replace(/\|/g, "\\|") + "`";
  else out = escapeCellText(core);
  if (f.italic) out = `*${out}*`;
  if (f.bold) out = `**${out}**`;
  if (f.strike) out = `~~${out}~~`;
  return lead + out + trail;
}

function linkTarget(href: string): string {
  const safe = href.replace(/\|/g, "%7C");
  return /[\s()<>]/.test(safe) ? `<${safe.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>` : safe;
}

/** Contenido de una celda en Markdown de una línea. */
export function cellMarkdown(runs: readonly Run[]): string {
  // Espacios como en HTML: cualquier blanco seguido cuenta como uno; los saltos, como un espacio.
  const flat: Run[] = [];
  for (const r of runs) {
    const text = r === BREAK ? " " : r.text.replace(/[\s ]+/g, " ");
    if (!text) continue;
    const prev = flat[flat.length - 1];
    if (prev && sameFormat(prev, r)) prev.text += text;
    else flat.push({ ...r, text });
  }
  let out = "";
  for (let i = 0; i < flat.length; ) {
    const href = flat[i]!.href;
    if (!href) {
      out += wrap(flat[i]!.text, flat[i]!);
      i++;
      continue;
    }
    let inner = "";
    for (; i < flat.length && flat[i]!.href === href; i++) inner += wrap(flat[i]!.text, { ...flat[i]!, href: undefined });
    const lead = /^\s*/.exec(inner)![0];
    const label = inner.trim();
    out += label ? `${lead}[${label}](${linkTarget(href)})${/\s$/.test(inner) ? " " : ""}` : inner;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

// ---------------------------------------------------------------- tablas

interface Cell {
  runs: Run[];
  colspan: number;
  rowspan: number;
  th: boolean;
}
interface Row {
  cells: Cell[];
  head: boolean;
}

const span = (v: string | undefined) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, MAX_SPAN) : 1;
};

/** Filas y celdas de una tabla (tokens de <table> a </table>). Las tablas anidadas se leen como texto de su celda. */
function readTable(tokens: readonly Token[]): Row[] {
  const rows: Row[] = [];
  let row: Row | null = null;
  let cell: Cell | null = null;
  /** Formato abierto dentro de la celda actual (pila de etiquetas). */
  let stack: { name: string; f: Format; hide: boolean }[] = [];
  let depth = 0;
  let inHead = false;
  const current = (): Format & { hide: boolean } => {
    const f: Format & { hide: boolean } = { hide: false };
    for (const s of stack) {
      if (s.hide) f.hide = true;
      // La etiqueta más interior manda (Google Docs: <b style="font-weight:normal"> con <span style="font-weight:700">).
      if (s.f.bold !== undefined) f.bold = s.f.bold;
      if (s.f.italic !== undefined) f.italic = s.f.italic;
      if (s.f.strike !== undefined) f.strike = s.f.strike;
      if (s.f.code !== undefined) f.code = s.f.code;
      if (s.f.href !== undefined) f.href = s.f.href;
    }
    return f;
  };
  const brk = () => {
    if (cell && cell.runs[cell.runs.length - 1] !== BREAK) cell.runs.push(BREAK);
  };
  for (const tok of tokens) {
    if (tok.kind === "open" && tok.name === "table") {
      depth++;
      if (depth > 1) brk();
      continue;
    }
    if (tok.kind === "close" && tok.name === "table") {
      depth--;
      if (depth >= 1) brk();
      continue;
    }
    if (depth === 1 && tok.kind === "open" && (tok.name === "thead" || tok.name === "tbody" || tok.name === "tfoot")) {
      inHead = tok.name === "thead";
      continue;
    }
    if (depth === 1 && tok.kind === "close" && tok.name === "thead") {
      inHead = false;
      continue;
    }
    if (depth === 1 && tok.kind === "open" && tok.name === "tr") {
      row = { cells: [], head: inHead };
      rows.push(row);
      cell = null;
      stack = [];
      continue;
    }
    if (depth === 1 && tok.kind === "close" && tok.name === "tr") {
      row = null;
      cell = null;
      continue;
    }
    if (depth === 1 && tok.kind === "open" && (tok.name === "td" || tok.name === "th")) {
      if (!row) {
        row = { cells: [], head: inHead };
        rows.push(row);
      }
      cell = { runs: [], colspan: span(tok.attrs.colspan), rowspan: span(tok.attrs.rowspan), th: tok.name === "th" };
      row.cells.push(cell);
      stack = [{ name: tok.name, f: formatOf(tok.name, tok.attrs), hide: false }];
      continue;
    }
    if (depth === 1 && tok.kind === "close" && (tok.name === "td" || tok.name === "th")) {
      cell = null;
      stack = [];
      continue;
    }
    if (!cell) continue;
    if (tok.kind === "text") {
      const f = current();
      if (!f.hide) cell.runs.push({ text: tok.text, bold: f.bold, italic: f.italic, strike: f.strike, code: f.code, href: f.href });
      continue;
    }
    if (tok.kind === "open") {
      if (tok.name === "br") {
        brk();
        continue;
      }
      if (tok.name === "td" || tok.name === "th") brk(); // celda de una tabla anidada
      if (BLOCK.has(tok.name)) brk();
      if (VOID.has(tok.name) || tok.selfClosing || RAW.has(tok.name)) continue;
      stack.push({ name: tok.name, f: formatOf(tok.name, tok.attrs), hide: hidden(tok.attrs) });
      continue;
    }
    // Cierre: se quita hasta la etiqueta que cierra (si está abierta dentro de la celda).
    if (BLOCK.has(tok.name) || tok.name === "td" || tok.name === "th") brk();
    const at = stack.map((s) => s.name).lastIndexOf(tok.name);
    if (at > 0) stack = stack.slice(0, at);
  }
  return rows;
}

/** Tabla Markdown de una tabla HTML (de <table> a </table>), o null si no merece serlo (vacía o de una sola celda). */
export function htmlTableToMarkdown(tableHtml: string): string | null {
  if (tableHtml.length > MAX_TABLE_HTML) return null;
  return tableFromTokens(tokenize(tableHtml));
}

function tableFromTokens(tokens: readonly Token[]): string | null {
  const rows = readTable(tokens);
  if (!rows.length) return null;
  // Celdas combinadas que se multiplican (300 celdas de 100×100 serían 3 millones): una tabla así no se convierte.
  let cells = 0;
  for (let r = 0; r < rows.length; r++) {
    for (const cell of rows[r]!.cells) {
      cells += cell.colspan * Math.min(cell.rowspan, rows.length - r);
      if (cells > MAX_TABLE_CELLS) return null;
    }
  }
  // Rejilla con las celdas combinadas: el contenido en la primera posición, el resto vacío.
  const grid: (Cell | null)[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r]![c] !== undefined) c++;
      for (let dr = 0; dr < cell.rowspan && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) grid[r + dr]![c + dc] = dr === 0 && dc === 0 ? cell : null;
      }
      c += cell.colspan;
    }
  });
  // Sin «Math.max(...)»: con muchas filas, repartir el array en argumentos desborda la pila.
  const width = grid.reduce((w, g) => Math.max(w, g.length), 0);
  if (width * grid.length > MAX_TABLE_CELLS) return null;
  const text = (cell: Cell | null | undefined, header: boolean) => {
    if (!cell) return "";
    // En la cabecera, una celda toda en negrita va sin «**» (la cabecera ya se ve en negrita).
    const allBold = header && cell.runs.every((r) => r === BREAK || !/\S/.test(r.text) || r.bold);
    return cellMarkdown(allBold ? cell.runs.map((r) => (r === BREAK ? r : { ...r, bold: false })) : cell.runs);
  };
  // Filas del todo vacías fuera (Word añade una fila oculta de celdas vacías para «columnas desalineadas»).
  const keep = grid
    .map((g, i) => ({ g, row: rows[i]! }))
    .filter((x) => Array.from({ length: width }, (_, i) => text(x.g[i], false)).some(Boolean));
  if (!keep.length || width === 0) return null;
  // Una sola celda: una caja de maquetación, no una tabla.
  if (keep.length === 1 && width === 1) return null;
  // Cabecera: la fila de <thead> o la primera de solo <th>; si no hay, la primera.
  let head = keep.findIndex((x) => x.row.head);
  if (head < 0) head = keep.findIndex((x) => x.row.cells.length > 0 && x.row.cells.every((c) => c.th));
  if (head < 0) head = 0;
  const ordered = [keep[head]!, ...keep.filter((_, i) => i !== head)];
  const line = (g: (Cell | null)[], header: boolean) => `| ${Array.from({ length: width }, (_, i) => text(g[i], header)).join(" | ")} |`;
  return [line(ordered[0]!.g, true), `| ${Array(width).fill("---").join(" | ")} |`, ...ordered.slice(1).map((x) => line(x.g, false))].join("\n");
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");

/** Marcador que el editor lee como su nodo de tabla Markdown (MarkdownTable: table[data-md-table]). */
export function markdownTablePlaceholder(md: string): string {
  return `<table data-md-table="${attr(md)}"></table>`;
}

/**
 * Cambia cada tabla de primer nivel del HTML pegado por el marcador de su tabla Markdown; lo demás queda igual. Sin
 * tablas (o si ninguna se puede convertir, o el HTML pasa de MAX_TABLE_HTML) devuelve el mismo texto.
 */
export function replaceHtmlTables(html: string, toPlaceholder: (md: string) => string = markdownTablePlaceholder): string {
  if (html.length > MAX_TABLE_HTML || !/<table[\s>]/i.test(html)) return html;
  const tokens = tokenize(html);
  let out = "";
  let last = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "open" || tok.name !== "table") continue;
    let depth = 0;
    let j = i;
    for (; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.kind === "open" && t.name === "table") depth++;
      else if (t.kind === "close" && t.name === "table" && --depth === 0) break;
    }
    const end = j < tokens.length ? tokens[j]!.end : html.length;
    const md = tableFromTokens(tokens.slice(i, j + 1));
    if (md) {
      out += html.slice(last, tok.start) + toPlaceholder(md);
      last = end;
    }
    i = j;
  }
  return last ? out + html.slice(last) : html;
}

/**
 * Markdown de un HTML pegado que solo trae tablas (Excel, Google Sheets, una tabla suelta de Word o de una web), para el
 * modo Markdown, donde el pegado normal daría el texto separado por tabuladores. Con algo más que tablas, null (el
 * pegado normal ya da el texto de todo, y una tabla a medias en medio no ayudaría).
 */
export function tablesOnlyMarkdown(html: string): string | null {
  const tables: string[] = [];
  const rest = replaceHtmlTables(html, (md) => {
    tables.push(md);
    return "";
  });
  if (!tables.length) return null;
  const text = tokenize(rest)
    .filter((t) => t.kind === "text")
    .map((t) => (t.kind === "text" ? t.text : ""))
    .join("");
  return /[^\s\u00a0]/.test(text) ? null : tables.join("\n\n");
}
