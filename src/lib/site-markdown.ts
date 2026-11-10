// Markdown → HTML sencillo y seguro para la web estática getpizarro.com (scripts/build-site.mjs): la licencia
// (LICENSE.md) y las guías de conexión (docs/guias/*.md y docs/guias/en/*.md). Node lo importa tal cual (sin alias
// «@/» ni dependencias), igual que site-content.ts.
//
// Admite: encabezados (#…####), párrafos, saltos de línea forzados (dos espacios o «\» al final), listas con viñetas
// y numeradas (anidadas por sangría), citas (>), bloques de código (```), tablas sencillas (| a | b |), líneas
// horizontales, **negrita**, *cursiva* o _cursiva_, `código` y enlaces [texto](https://…) o <https://…>.
// Todo lo demás se escapa: el HTML que haya en el texto se ve como texto (los comentarios <!-- … --> se quitan), las
// imágenes se quedan en su texto alternativo y un enlace que no sea http(s), un ancla (#…) o lo que acepte `link`
// se queda en su texto.

export type LinkResolver = (href: string) => string | null;

export const escapeHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Identificador de un encabezado: minúsculas, sin acentos, palabras unidas con «-». */
export const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Enlaces admitidos por defecto: http(s) absolutos y anclas de la misma página. */
export function safeHref(href: string): string | null {
  if (/^https?:\/\/[^\s"'<>`]+$/i.test(href)) return href;
  if (/^#[\w-]+$/.test(href)) return href;
  return null;
}

const emphasis = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>");

/** Texto en línea: código, enlaces y énfasis; todo lo demás, escapado. */
export function inlineMarkdown(s: string, link: LinkResolver = safeHref): string {
  const links = (part: string) => {
    let out = "";
    let last = 0;
    for (const m of part.matchAll(/(!?)\[([^\]]+)\]\(([^()\s]+)\)|<(https?:\/\/[^\s<>]+)>/g)) {
      out += emphasis(part.slice(last, m.index));
      last = (m.index ?? 0) + m[0].length;
      const text = m[2] ?? m[4] ?? "";
      if (m[1]) {
        out += emphasis(text); // imagen: solo su texto alternativo
        continue;
      }
      const href = link(m[3] ?? m[4] ?? "");
      out += href ? `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' rel="noopener"' : ""}>${emphasis(text)}</a>` : emphasis(text);
    }
    return out + emphasis(part.slice(last));
  };
  let out = "";
  let last = 0;
  for (const m of s.matchAll(/`([^`]+)`/g)) {
    out += links(s.slice(last, m.index));
    out += `<code>${escapeHtml(m[1] ?? "")}</code>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + links(s.slice(last));
}

/** Texto plano de una línea de Markdown (para descripciones y títulos). */
export const plainText = (s: string) =>
  s.replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<(https?:\/\/[^>]+)>/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const blank = (l: string) => !l.trim();
const indentOf = (l: string) => l.length - l.trimStart().length;
const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || RULE.test(l) || LIST.test(l) || /^\s*>/.test(l);

/** Markdown → HTML. `link` decide qué enlaces se admiten (y puede reescribirlos). */
export function markdownToHtml(md: string, { link = safeHref }: { link?: LinkResolver } = {}): string {
  const ids = new Set<string>();
  return blocks(md.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n"), link, ids);
}

function blocks(lines: string[], link: LinkResolver, ids: Set<string>): string {
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
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(fence[1] ?? "```")) code.push((lines[i++] ?? "").replace(new RegExp(`^ {0,${pad}}`), ""));
      i++; // cierre
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const level = (h[1] ?? "#").length;
      const text = h[2] ?? "";
      let id = slugify(plainText(text)) || "seccion";
      for (let n = 2; ids.has(id); n++) id = `${slugify(plainText(text))}-${n}`;
      ids.add(id);
      html.push(`<h${level} id="${id}">${inlineMarkdown(text, link)}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) quote.push((lines[i++] ?? "").replace(/^\s*> ?/, ""));
      html.push(`<blockquote>${blocks(quote, link, ids)}</blockquote>`);
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
    if (LIST.test(line)) {
      i = list(lines, i, link, ids, html);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i] ?? "") && (para.length === 0 || !startsBlock(lines[i] ?? ""))) {
      const l = lines[i++] ?? "";
      const hard = / {2,}$|\\$/.test(l);
      para.push(l.trim().replace(/\\$/, "") + (hard ? "\u0000" : ""));
    }
    html.push(`<p>${inlineMarkdown(para.join(" ").replace(/\u0000 /g, "\u0000").replace(/\u0000$/, ""), link).replace(/\u0000/g, "<br>")}</p>`);
  }
  return html.join("\n");
}

/** Una lista (con sus sublistas) desde la línea `start`; devuelve la línea siguiente. */
function list(lines: string[], start: number, link: LinkResolver, ids: Set<string>, html: string[]): number {
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
    const pad = Math.min(...rest.filter((l) => !blank(l)).map(indentOf), Infinity);
    const text = [item[0] ?? "", ...rest.map((l) => (blank(l) ? "" : l.slice(Number.isFinite(pad) ? pad : 0)))].join("\n");
    let inner = blocks(text.split("\n"), link, ids);
    if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
    return `<li>${inner}</li>`;
  }).join("");
  const n = ordered ? parseInt(first?.[2] ?? "1", 10) : 1;
  html.push(ordered ? `<ol${n !== 1 ? ` start="${n}"` : ""}>${body}</ol>` : `<ul>${body}</ul>`);
  return i;
}

export type Guide = { title: string; description: string; order: number; icon: string | null; body: string };

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
