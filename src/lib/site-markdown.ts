// Markdown → HTML sencillo y seguro para la web estática getpizarro.com (scripts/build-site.mjs): la licencia
// (LICENSE.md), las guías de conexión (docs/guias/*.md y docs/guias/en/*.md) y la guía de instalación
// (docs/web/instalar.md y docs/web/en/install.md). Node lo importa tal cual (sin alias «@/» ni dependencias), igual
// que site-content.ts.
//
// Admite: encabezados (#…####, con un identificador fijo opcional al final: «## Actualizar {#actualizar}»), párrafos,
// saltos de línea forzados (dos espacios o «\» al final), listas con viñetas y numeradas (anidadas por sangría), citas
// (>) y avisos al estilo de GitHub («> [!NOTE]», [!TIP], [!IMPORTANT], [!WARNING] o [!CAUTION]), bloques de código
// (```, con su lenguaje), tablas sencillas (| a | b |), líneas horizontales, **negrita**, *cursiva* o _cursiva_,
// `código` y enlaces [texto](https://…) o <https://…>.
// Todo lo demás se escapa: el HTML que haya en el texto se ve como texto (los comentarios <!-- … --> se quitan), las
// imágenes se quedan en su texto alternativo y un enlace que no sea http(s), un ancla (#…) o lo que acepte `link`
// se queda en su texto.

// Con la extensión: Node (build-site.mjs) carga este fichero sin empaquetador y no resuelve rutas sin ella.
import { escapeHtml } from "./html-escape.ts";
import { slugify } from "./search-accents.ts";

type LinkResolver = (href: string) => string | null;

/** Enlaces admitidos por defecto: http(s) absolutos y anclas de la misma página. @public (scripts/build-site.mjs) */
export function safeHref(href: string): string | null {
  if (/^https?:\/\/[^\s"'<>`]+$/i.test(href)) return href;
  if (/^#[\w-]+$/.test(href)) return href;
  return null;
}

type Delim = { ch: "*" | "_"; n: number; opens: string[]; closes: string[] };

const SPACE = /\s/u;
const PUNCT = /[\p{P}\p{S}]/u;

/**
 * **negrita**, *cursiva* y _cursiva_ con las reglas de CommonMark para abrir y cerrar (un «_» dentro de una palabra,
 * como en snake_case, no cuenta) y siempre bien anidadas: un cierre empareja con la apertura más cercana del mismo
 * carácter y las que quedan entre medias se ven como texto. Lineal (una pila: cada marca entra y sale una vez); sin la
 * «regla del 3» de CommonMark, que aquí no hace falta.
 */
function emphasis(s: string): string {
  const out: (string | Delim)[] = [];
  const stack: Delim[] = [];
  const open = { "*": 0, _: 0 };
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] !== "*" && s[j] !== "_") j++;
    if (j > i) out.push(escapeHtml(s.slice(i, j)));
    if (j >= s.length) break;
    const ch = s[j] as "*" | "_";
    let k = j;
    while (k < s.length && s[k] === ch) k++;
    const before = j > 0 ? s[j - 1]! : " ";
    const after = k < s.length ? s[k]! : " ";
    const left = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
    const right = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
    const canOpen = ch === "*" ? left : left && (!right || PUNCT.test(before));
    const canClose = ch === "*" ? right : right && (!left || PUNCT.test(after));
    const d: Delim = { ch, n: k - j, opens: [], closes: [] };
    out.push(d);
    if (canClose) {
      while (d.n > 0 && open[ch] > 0) {
        // Las marcas abiertas después de la apertura que se cierra quedan como texto (así no se cruzan las etiquetas).
        let top = stack[stack.length - 1]!;
        while (top.ch !== ch) {
          stack.pop();
          open[top.ch]--;
          top = stack[stack.length - 1]!;
        }
        const use = top.n >= 2 && d.n >= 2 ? 2 : 1;
        const tag = use === 2 ? "strong" : "em";
        top.n -= use;
        d.n -= use;
        top.opens.push(`<${tag}>`);
        d.closes.push(`</${tag}>`);
        if (top.n === 0) {
          stack.pop();
          open[ch]--;
        }
      }
    }
    if (d.n > 0 && canOpen) {
      stack.push(d);
      open[ch]++;
    }
    i = k;
  }
  // Cada apertura: lo que sobra de la marca, como texto, y después sus etiquetas (la última emparejada es la exterior).
  return out.map((p) => (typeof p === "string" ? p : `${p.closes.join("")}${p.ch.repeat(p.n)}${p.opens.reverse().join("")}`)).join("");
}

/** Texto en línea: código, enlaces y énfasis; todo lo demás, escapado. */
export function inlineMarkdown(s: string, link: LinkResolver = safeHref): string {
  // El código va primero, como un marcador (caracteres de uso privado): así «**la rama `stable`**» sigue siendo
  // negrita y lo de dentro del código no se interpreta.
  const codes: string[] = [];
  const src = s.replace(/[]/g, "").replace(/`([^`]+)`/g, (_, c: string) => `${codes.push(c) - 1}`);
  const MARK = /(\d+)/g;
  const source = (t: string) => t.replace(MARK, (_, i: string) => `\`${codes[Number(i)] ?? ""}\``);
  let out = "";
  let last = 0;
  for (const m of src.matchAll(/(!?)\[([^[\]]+)\]\(([^()\s]+)\)|<(https?:\/\/[^\s<>]+)>/g)) {
    out += emphasis(src.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const text = m[2] ?? source(m[4] ?? "");
    if (m[1]) {
      out += emphasis(text); // imagen: solo su texto alternativo
      continue;
    }
    // La dirección, tal como se escribió (con sus «`» si los tenía: entonces ningún resolutor la admite).
    const href = link(source(m[3] ?? m[4] ?? ""));
    out += href ? `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' rel="noopener"' : ""}>${emphasis(text)}</a>` : emphasis(text);
  }
  out += emphasis(src.slice(last));
  return out.replace(MARK, (_, i: string) => `<code>${escapeHtml(codes[Number(i)] ?? "")}</code>`);
}

/** Texto plano de una línea de Markdown (para descripciones y títulos). */
const plainText = (s: string) =>
  s.replace(/!?\[([^[\]]+)\]\([^)]*\)/g, "$1").replace(/<(https?:\/\/[^>]+)>/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const blank = (l: string) => !l.trim();
const indentOf = (l: string) => l.length - l.trimStart().length;
const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || LIST.test(l) || /^\s*>/.test(l);

/** Tipos de aviso («> [!NOTE]» y compañía, como en GitHub). */
type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";
/** Rótulo de cada tipo de aviso; por defecto, en español. */
const CALLOUT_LABELS: Record<CalloutKind, string> = { note: "Nota", tip: "Consejo", important: "Importante", warning: "Atención", caution: "Cuidado" };

/** Un encabezado del documento (para el índice): nivel, identificador y su HTML. */
type Heading = { level: number; id: string; html: string };

type MarkdownOptions = {
  /** Qué enlaces se admiten (y cómo se reescriben). */
  link?: LinkResolver;
  /** Si se pasa, se le añaden los encabezados en orden. */
  headings?: Heading[];
  /** Rótulos de los avisos (p. ej. en inglés). */
  callouts?: Partial<Record<CalloutKind, string>>;
  /**
   * HTML de un bloque de código; recibe el texto sin escapar y el lenguaje («bash», «text»… o ""). Debe escapar el
   * texto (escapeHtml). Sin él: <pre><code>…</code></pre>.
   */
  code?: (text: string, lang: string) => string;
};

type Ctx = { link: LinkResolver; ids: Set<string>; headings: Heading[] | null; callouts: Record<CalloutKind, string>; code: ((text: string, lang: string) => string) | null };

/** Markdown → HTML. `link` decide qué enlaces se admiten (y puede reescribirlos). */
export function markdownToHtml(md: string, { link = safeHref, headings, callouts, code }: MarkdownOptions = {}): string {
  const ctx: Ctx = { link, ids: new Set<string>(), headings: headings ?? null, callouts: { ...CALLOUT_LABELS, ...callouts }, code: code ?? null };
  return blocks(md.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n"), ctx, 0);
}

const CALLOUT = /^\s*\[!(note|tip|important|warning|caution)\]\s*$/i;
const HEADING_ID = /\s*\{#([a-z0-9]+(?:-[a-z0-9]+)*)\}\s*$/;

/**
 * Niveles de citas y listas anidadas que se interpretan; más adentro, las líneas se ven como texto. Sin tope, 5.000
 * «>» seguidos o 2.000 niveles de lista agotaban la pila (y la memoria: cada nivel copia sus líneas).
 */
const MAX_NESTING = 20;

function blocks(lines: string[], ctx: Ctx, depth: number): string {
  const { link, ids } = ctx;
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      const pad = indentOf(line);
      const lang = (line.trim().slice(3).trim().split(/\s/)[0] ?? "").toLowerCase();
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(fence[1] ?? "```")) code.push((lines[i++] ?? "").replace(new RegExp(`^ {0,${pad}}`), ""));
      i++; // cierre
      const text = code.join("\n");
      html.push(ctx.code ? ctx.code(text, lang) : `<pre><code>${escapeHtml(text)}</code></pre>`);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const level = (h[1] ?? "#").length;
      let text = h[2] ?? "";
      // «{#id}» al final fija el identificador (para enlazar a la sección aunque cambie el título).
      const fixed = HEADING_ID.exec(text);
      if (fixed) text = text.slice(0, fixed.index);
      const base = fixed?.[1] ?? (slugify(plainText(text)) || "seccion");
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
      ids.add(id);
      const inner = inlineMarkdown(text, link);
      ctx.headings?.push({ level, id, html: inner });
      html.push(`<h${level} id="${id}">${inner}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (depth < MAX_NESTING && /^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) quote.push((lines[i++] ?? "").replace(/^\s*> ?/, ""));
      const kind = CALLOUT.exec(quote[0] ?? "")?.[1]?.toLowerCase() as CalloutKind | undefined;
      if (kind) {
        html.push(`<div class="callout callout-${kind}" role="note"><p class="callout-title">${escapeHtml(ctx.callouts[kind])}</p>${blocks(quote.slice(1), ctx, depth + 1)}</div>`);
      } else {
        html.push(`<blockquote>${blocks(quote, ctx, depth + 1)}</blockquote>`);
      }
      continue;
    }
    if (line.trimStart().startsWith("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trimStart().startsWith("|")) rows.push(cells(lines[i++] ?? ""));
      const tr = (r: string[], tag: string) => `<tr>${head.map((_, k) => `<${tag}>${inlineMarkdown(r[k] ?? "", link)}</${tag}>`).join("")}</tr>`;
      html.push(`<div class="table"><table><thead>${tr(head, "th")}</thead><tbody>${rows.map((r) => tr(r, "td")).join("")}</tbody></table></div>`);
      continue;
    }
    if (depth < MAX_NESTING && LIST.test(line)) {
      i = list(lines, i, ctx, html, depth);
      continue;
    }
    const para: string[] = [];
    // Pasado el tope de anidamiento, las citas y listas que quedan son texto del párrafo.
    const stops = (l: string) => (depth < MAX_NESTING ? startsBlock(l) : FENCE.test(l) || HEADING.test(l) || RULE.test(l));
    while (i < lines.length && !blank(lines[i] ?? "") && (para.length === 0 || !stops(lines[i] ?? ""))) {
      const l = lines[i++] ?? "";
      const hard = l.endsWith("  ") || l.endsWith("\\"); // sin regex: « {2,}$» es cuadrática con mucha sangría
      para.push(l.trim().replace(/\\$/, "") + (hard ? "\u0000" : ""));
    }
    html.push(`<p>${inlineMarkdown(para.join(" ").replace(/\u0000 /g, "\u0000").replace(/\u0000$/, ""), link).replace(/\u0000/g, "<br>")}</p>`);
  }
  return html.join("\n");
}

/** Una lista (con sus sublistas) desde la línea `start`; devuelve la línea siguiente. */
function list(lines: string[], start: number, ctx: Ctx, html: string[], depth: number): number {
  const first = LIST.exec(lines[start] ?? "");
  const indent = first?.[1]?.length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? "");
  const sameList = (m: RegExpExecArray | null) => m && (m[1] ?? "").length === indent && /\d/.test(m[2] ?? "") === ordered;
  const items: string[][] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const l = lines[i] ?? "";
    const m = LIST.exec(l);
    if (sameList(m)) {
      items.push([m?.[3] ?? ""]);
      i++;
      continue;
    }
    if (blank(l)) {
      let j = i;
      while (j < lines.length && blank(lines[j] ?? "")) j++;
      const next = lines[j] ?? "";
      if (j >= lines.length || !(sameList(LIST.exec(next)) || indentOf(next) > indent)) break;
      loose = true;
      for (; i < j; i++) items.at(-1)?.push("");
      continue;
    }
    // Sublista o continuación (sangrada), o continuación «perezosa» de la línea anterior.
    if (indentOf(l) > indent || (!m && !startsBlock(l) && !blank(lines[i - 1] ?? ""))) {
      items.at(-1)?.push(l);
      i++;
      continue;
    }
    break;
  }
  const body = items.map((item) => {
    const rest = item.slice(1);
    let pad = Infinity;
    for (const l of rest) if (!blank(l)) pad = Math.min(pad, indentOf(l));
    const text = [item[0] ?? "", ...rest.map((l) => (blank(l) ? "" : l.slice(Number.isFinite(pad) ? pad : 0)))].join("\n");
    let inner = blocks(text.split("\n"), ctx, depth + 1);
    if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
    return `<li>${inner}</li>`;
  }).join("");
  const n = ordered ? parseInt(first?.[2] ?? "1", 10) : 1;
  html.push(ordered ? `<ol${n !== 1 ? ` start="${n}"` : ""}>${body}</ol>` : `<ul>${body}</ul>`);
  return i;
}

type Guide = { title: string; description: string; order: number; icon: string | null; body: string };

/**
 * Cabecera y cuerpo de una guía de docs/guias. La cabecera puede ser un front-matter mínimo
 *   ---
 *   titulo: Avisos por Telegram
 *   descripcion: Una frase para la tarjeta del índice.
 *   orden: 3
 *   icono: send
 *   ---
 * o comentarios al principio (<!-- orden: 3 -->). Sin `titulo`, vale el primer «# Título»; sin `descripcion`, el
 * primer párrafo. El «# Título» del principio se quita del cuerpo (la página ya lo muestra). Sin `orden`, va al final.
 */
export function parseGuide(text: string): Guide {
  let s = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const meta: Record<string, string> = {};
  const pairs = (block: string) => {
    for (const part of block.split(/\n|;/)) {
      const kv = /^\s*([\p{L}_-]+)\s*:\s*(.*?)\s*$/u.exec(part);
      if (kv?.[1] && kv[2] != null) meta[kv[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  };
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(s);
  if (fm) {
    pairs(fm[1] ?? "");
    s = s.slice(fm[0].length);
  }
  for (let c = /^\s*<!--([\s\S]*?)-->[ \t]*\n?/.exec(s); c; c = /^\s*<!--([\s\S]*?)-->[ \t]*\n?/.exec(s)) {
    pairs(c[1] ?? "");
    s = s.slice(c[0].length);
  }
  const h1 = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(\n|$)/.exec(s);
  if (h1) s = s.slice(h1[0].length);
  const firstPara = s.replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !startsBlock(b.split("\n")[0] ?? "") && !b.startsWith("|"));
  const order = Number(meta.orden ?? meta.order);
  return {
    title: plainText(meta.titulo ?? meta.title ?? h1?.[1] ?? ""),
    description: plainText(meta.descripcion ?? meta.description ?? firstPara ?? ""),
    order: Number.isFinite(order) && (meta.orden ?? meta.order ?? "").trim() !== "" ? order : 1000,
    icon: (meta.icono ?? meta.icon ?? "").trim() || null,
    body: s.trim(),
  };
}
