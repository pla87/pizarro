// Markdown de una descripción → bloques sencillos y serializables para pintarlos en un PDF (@react-pdf no entiende
// Markdown ni HTML). Función pura: el proceso web la usa al preparar los datos y el worker de PDF solo pinta bloques.
// Cubre lo que produce el editor: títulos, párrafos, negrita, cursiva, tachado, subrayado (++x++), código, enlaces,
// listas (también de tareas y anidadas), citas, tablas y separadores. Las imágenes se quedan en su texto alternativo
// y las menciones, en «@Nombre». El HTML no se interpreta: se muestra como texto.
import { Marked, type Token, type Tokens } from "marked";
import { decodeEntities } from "./markdown-entities";
import { UNDERLINE_HREF, underlineToLink } from "./markdown-underline";
import { mentionsToPlain } from "./mentions";

/** Trozo de texto con su formato. `href` solo para enlaces http(s) o mailto. */
export interface PdfRun {
  text: string;
  b?: true;
  i?: true;
  s?: true;
  u?: true;
  code?: true;
  href?: string;
}

export type PdfBlock =
  | { t: "p"; runs: PdfRun[] }
  | { t: "h"; level: number; runs: PdfRun[] }
  | { t: "list"; ordered: boolean; start: number; items: { checked: boolean | null; blocks: PdfBlock[] }[] }
  | { t: "code"; text: string }
  | { t: "quote"; blocks: PdfBlock[] }
  | { t: "table"; header: PdfRun[][]; rows: PdfRun[][][] }
  | { t: "hr" };

/** Profundidad máxima de listas y citas anidadas: lo que pase se aplana (una descripción no necesita más). */
const MAX_DEPTH = 6;

type Style = Omit<PdfRun, "text">;
const styleKey = (r: Style) => [r.b, r.i, r.s, r.u, r.code, r.href].join("|");

function safeLink(href: string): string | undefined {
  return /^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}

function inline(tokens: Token[] | undefined, style: Style, out: PdfRun[] = []): PdfRun[] {
  const push = (text: string, st: Style) => {
    if (!text) return;
    const last = out[out.length - 1];
    // Trozos seguidos con el mismo formato van juntos (menos nodos que pintar).
    if (last && styleKey(last) === styleKey(st)) last.text += text;
    else out.push({ text, ...st });
  };
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case "strong": inline((tok as Tokens.Strong).tokens, { ...style, b: true }, out); break;
      case "em": inline((tok as Tokens.Em).tokens, { ...style, i: true }, out); break;
      case "del": inline((tok as Tokens.Del).tokens, { ...style, s: true }, out); break;
      case "codespan": push((tok as Tokens.Codespan).text, { ...style, code: true }); break;
      case "br": push("\n", style); break;
      case "link": {
        const link = tok as Tokens.Link;
        if (link.href === UNDERLINE_HREF) inline(link.tokens, { ...style, u: true }, out);
        else {
          const href = safeLink(link.href);
          inline(link.tokens, href ? { ...style, href } : style, out);
        }
        break;
      }
      case "image": {
        const alt = decodeEntities((tok as Tokens.Image).text).trim();
        push(`[${alt || "img"}]`, { ...style, i: true });
        break;
      }
      case "text": {
        const text = tok as Tokens.Text;
        if (text.tokens?.length) inline(text.tokens, style, out);
        else push(decodeEntities(text.text), style);
        break;
      }
      case "escape": push(decodeEntities((tok as Tokens.Escape).text), style); break;
      case "checkbox": break;
      default: push(decodeEntities("text" in tok && typeof tok.text === "string" ? tok.text : tok.raw), style);
    }
  }
  return out;
}

function blocks(tokens: Token[], depth: number): PdfBlock[] {
  const out: PdfBlock[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "space": case "def": case "checkbox": break;
      case "heading": {
        const h = tok as Tokens.Heading;
        out.push({ t: "h", level: Math.min(Math.max(h.depth, 1), 6), runs: inline(h.tokens, {}) });
        break;
      }
      case "paragraph": out.push({ t: "p", runs: inline((tok as Tokens.Paragraph).tokens, {}) }); break;
      // Texto suelto dentro de un elemento de lista sin separar.
      case "text": {
        const text = tok as Tokens.Text;
        out.push({ t: "p", runs: text.tokens?.length ? inline(text.tokens, {}) : [{ text: decodeEntities(text.text) }] });
        break;
      }
      case "code": out.push({ t: "code", text: (tok as Tokens.Code).text }); break;
      case "hr": out.push({ t: "hr" }); break;
      case "blockquote": {
        const inner = blocks((tok as Tokens.Blockquote).tokens, depth + 1);
        if (depth >= MAX_DEPTH) out.push(...inner);
        else out.push({ t: "quote", blocks: inner });
        break;
      }
      case "list": {
        const list = tok as Tokens.List;
        const items = list.items.map((item) => ({ checked: item.task ? !!item.checked : null, blocks: blocks(item.tokens, depth + 1) }));
        if (depth >= MAX_DEPTH) out.push(...items.flatMap((i) => i.blocks));
        else out.push({ t: "list", ordered: list.ordered, start: typeof list.start === "number" ? list.start : 1, items });
        break;
      }
      case "table": {
        const table = tok as Tokens.Table;
        out.push({ t: "table", header: table.header.map((c) => inline(c.tokens, {})), rows: table.rows.map((r) => r.map((c) => inline(c.tokens, {}))) });
        break;
      }
      // HTML u otros: su texto tal cual, sin interpretarlo.
      default: {
        const raw = "text" in tok && typeof tok.text === "string" ? tok.text : tok.raw;
        if (raw.trim()) out.push({ t: "p", runs: [{ text: decodeEntities(raw.trim()) }] });
      }
    }
  }
  return out;
}

/** Bloques de un Markdown de descripción, listos para el PDF. Vacío si no hay nada que pintar. */
export function markdownToPdfBlocks(markdown: string): PdfBlock[] {
  const source = underlineToLink(mentionsToPlain(markdown ?? "")).replace(/(?:\s|&nbsp;)+$/, "");
  if (!source.trim()) return [];
  const lexer = new Marked({ gfm: true, breaks: false });
  return blocks(lexer.lexer(source), 0);
}
