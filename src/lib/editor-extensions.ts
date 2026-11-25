import { Node, mergeAttributes } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Paragraph } from "@tiptap/extension-paragraph";
import { OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { isAttachmentSrc } from "./attachment-refs";

/** Idioma de la página (las vistas del editor se pintan fuera de React y no tienen `t`). */
const pageIsEnglish = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("en");

/**
 * Código en línea que convive con negrita, cursiva, tachado, subrayado y enlaces (`**`x`**`, `[`npm`](url)`).
 * El de TipTap excluye cualquier otra marca: el Markdown con código dentro de una negrita o de un enlace no cabía en el
 * documento y pegarlo (o abrirlo) lanzaba «Invalid collection of marks for node text: bold,code» sin pegar nada.
 */
const InlineCode = Code.extend({ excludes: "code" });

/**
 * Bloque de código que no gana una línea vacía al final. marked 18 (el de TipTap desde que usa la misma versión que la
 * app, `overrides` en package.json) deja el salto de línea final en el texto de un bloque sangrado con 4 espacios al final
 * del documento («    código\n» → «código\n»; marked 17 lo quitaba): abrir y guardar en el editor con barra añadía una
 * línea vacía dentro del bloque. Por lo demás, como el de TipTap (solo bloques con ``` o ~~~ y sangrados).
 */
const TrimmedCodeBlock = CodeBlock.extend({
  parseMarkdown: (token, helpers) => {
    const raw = token.raw;
    // Cercado también con 1 a 3 espacios delante de la valla (CommonMark): antes solo «```» o «~~~» en la columna 0, y un
    // bloque sangrado así se borraba al abrir el editor.
    if (typeof raw === "string" && !FENCE_LINE.test(raw) && token.codeBlockStyle !== "indented") return [];
    const text = token.codeBlockStyle === "indented" ? String(token.text ?? "").replace(/\n+$/, "") : fencedCodeText(String(raw ?? ""), tildeFenceText(String(raw ?? ""), String(token.text ?? "")));
    return helpers.createNode("codeBlock", { language: token.lang || null }, text ? [helpers.createTextNode(text)] : []);
  },
  renderMarkdown: (node, h) => {
    const language = String(node.attrs?.language ?? "");
    const body = node.content ? h.renderChildren(node.content) : "";
    const fence = codeFence(body, language);
    return `${fence}${language}\n${body}\n${fence}`;
  },
});

/**
 * Valla de un bloque de código al guardarlo: acentos graves, uno más que la tira más larga del contenido al principio de
 * una línea (como mínimo 3). Con «```» fijo (el de TipTap), un bloque «~~~» o «````» con «```» dentro se cerraba antes
 * de tiempo y se rompía en cada guardado. Si el lenguaje lleva un acento grave (no cabe tras una valla de acentos), tildes.
 */
function codeFence(body: string, language = ""): string {
  const char = language.includes("`") ? "~" : "`";
  const run = new RegExp(`^ {0,3}(\\${char}{3,})`, "gm");
  let longest = 2;
  for (const m of body.matchAll(run)) longest = Math.max(longest, m[1]!.length);
  return char.repeat(longest + 1);
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * marked solo quita a las líneas de dentro la sangría de la valla de apertura cuando es de acentos («  ```»); con tildes
 * («  ~~~») las deja con sus espacios, y el editor los guardaba como parte del código. Aquí se quitan igual (CommonMark).
 */
function tildeFenceText(raw: string, text: string): string {
  const indent = /^( *)~/.exec(raw)?.[1]!.length ?? 0;
  if (!indent) return text;
  const lead = new RegExp(`^ {0,${indent}}`);
  return text.split("\n").map((l) => l.replace(lead, "")).join("\n");
}

/**
 * Texto de un bloque cercado («```») con tantos saltos de línea al final como líneas vacías tiene dentro, ni uno más.
 * marked 18.2 añade un salto al texto de un bloque que acaba en una línea vacía («```\ncódigo\n\n```» da «código\n\n»;
 * antes, «código\n»), y el editor escribe el texto seguido de otro salto y la valla: cada guardado sumaba una línea vacía.
 * Las líneas de dentro se cuentan en el propio Markdown (`raw`), así que vale con cualquier versión de marked. Sin valla
 * de cierre (el bloque sigue hasta el final), sin líneas vacías al final, como el sangrado.
 */
function fencedCodeText(raw: string, text: string): string {
  const lines = raw.replace(/\n+$/, "").split("\n");
  const open = FENCE_LINE.exec(lines[0] ?? "")?.[1];
  const last = lines.length > 1 ? lines[lines.length - 1]!.trim() : "";
  const closed = !!open && last.length >= open.length && last.startsWith(open[0]!) && [...last].every((c) => c === open[0]);
  const body = text.replace(/\n+$/, "");
  if (!closed) return body;
  const content = lines.slice(1, -1);
  // Vacía también si solo tiene los espacios que se quitan por la sangría de la valla de apertura.
  const indent = /^ */.exec(lines[0]!)![0].length;
  const empty = (l: string) => l === "" || (/^ +$/.test(l) && l.length <= indent);
  let blank = 0;
  while (blank < content.length && empty(content[content.length - 1 - blank]!)) blank++;
  // Solo líneas vacías: el texto son sus saltos entre ellas (una sola vacía es un bloque vacío, como lo escribe el editor).
  const newlines = blank === content.length ? Math.max(0, blank - 1) : blank;
  return body + "\n".repeat(newlines);
}

/** Celdas de una tabla GFM («| a | b |»), sin la fila separadora; el texto de cada celda tal cual (con su Markdown). */
export function tableRows(raw: string): string[][] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines
    .filter((_, i) => i !== 1)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/(?<!\\)\|$/, "")
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, "|")),
    );
}

/**
 * Tabla de Markdown (GFM). El editor con barra no edita tablas, pero tampoco puede perderlas: se muestra como tabla (de
 * solo lectura, se edita en el modo Markdown) y se guarda exactamente con el texto original. Sin este nodo, abrir y
 * guardar una descripción con una tabla en el editor con barra la borraba.
 */
const MarkdownTable = Node.create({
  name: "markdownTable",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { raw: { default: "", rendered: false } };
  },
  parseHTML() {
    return [{ tag: "table[data-md-table]", getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-md-table") ?? "" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.raw ?? "");
    const [head = [], ...body] = tableRows(raw);
    return [
      "table",
      mergeAttributes(HTMLAttributes, {
        "data-md-table": raw,
        class: "md-table",
        title: pageIsEnglish() ? "Table: edit it in Markdown mode" : "Tabla: se edita en el modo Markdown",
      }),
      ["thead", ["tr", ...head.map((c) => ["th", c])]],
      ["tbody", ...body.map((r) => ["tr", ...r.map((c) => ["td", c])])],
    ];
  },
  markdownTokenName: "table",
  parseMarkdown: (token, helpers) => helpers.createNode("markdownTable", { raw: String(token.raw ?? "").replace(/\n+$/, "") }),
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});

/** Una sola imagen de Markdown, sin título ni nada más: `![texto](dirección)` (los `[` y `]` del texto, escapados). */
const ONE_IMAGE = /^!\[(?:\\.|[^\\[\]\n])*\]\([^\s()<>]*\)$/;

/**
 * Markdown original de una imagen pegada como HTML (`data-md-image`, el que escribe el propio editor al copiar): solo si es
 * exactamente una imagen. Un HTML de fuera podía traer ahí cualquier texto («@[Ana](user:…) [clic](https://…)»): el editor
 * enseñaba «[imagen: ]» y al guardar quedaba en la descripción una mención o un enlace que nadie había visto. Si no lo es,
 * vacío, y la imagen se vuelve a escribir con su texto y su dirección (imageMarkdownOf).
 */
function pastedImageRaw(raw: string | null): string {
  return raw && ONE_IMAGE.test(raw) ? raw : "";
}

/** `![texto](dirección)` con el texto escapado y la dirección sin espacios, paréntesis ni `<>` que cierren la imagen antes. */
function imageMarkdownOf(alt: string, src: string): string {
  const text = alt.replace(/\s+/g, " ").replace(/[[\]\\]/g, "\\$&");
  const href = src.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `![${text}](${href})`;
}

/**
 * Imagen de Markdown (`![texto](/api/attachments/…)`): se ve en el editor si es un adjunto (como en la descripción
 * guardada) y se guarda con el texto original. Sin este nodo el editor con barra la convertía en su texto alternativo.
 */
const MarkdownImage = Node.create({
  name: "markdownImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { raw: { default: "", rendered: false }, src: { default: "", rendered: false }, alt: { default: "", rendered: false } };
  },
  parseHTML() {
    return [
      {
        tag: "[data-md-image]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return { raw: pastedImageRaw(e.getAttribute("data-md-image")), src: e.getAttribute("data-src") ?? "", alt: e.getAttribute("data-alt") ?? "" };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { raw, src, alt } = node.attrs as { raw: string; src: string; alt: string };
    const data = { "data-md-image": raw, "data-src": src, "data-alt": alt };
    if (isAttachmentSrc(src)) return ["img", mergeAttributes(HTMLAttributes, data, { src, alt, class: "max-w-full rounded" })];
    return ["span", mergeAttributes(HTMLAttributes, data, { class: "text-slate-400" }), `[${pageIsEnglish() ? "image" : "imagen"}: ${alt}]`];
  },
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) =>
    helpers.createNode("markdownImage", { raw: String(token.raw ?? ""), src: String(token.href ?? ""), alt: String(token.text ?? "") }),
  renderMarkdown: (node) => {
    const { raw, src, alt } = (node.attrs ?? {}) as { raw?: string; src?: string; alt?: string };
    return raw || imageMarkdownOf(String(alt ?? ""), String(src ?? ""));
  },
});

/**
 * Texto de un párrafo que, al principio de una línea, se leería como otro bloque («# », «- », «+ », «2026. », «---»):
 * se escapa al guardarlo. TipTap no lo hacía y un «\\# no es un título» volvía como título (o «2026\\. Año» como lista).
 */
export function escapeBlockStarts(md: string): string {
  return md
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s{0,3})(#{1,6}|[-+])(?=\s|$)/, "$1\\$2")
        .replace(/^(\s{0,3}\d{1,9})([.)])(?=\s|$)/, "$1\\$2")
        .replace(/^(\s{0,3})(=+|-{2,})(\s*)$/, "$1\\$2$3"),
    )
    .join("\n");
}

/**
 * Párrafo: con solo una imagen, TipTap la saca del párrafo (espera una imagen de bloque) y una imagen en línea suelta en el
 * documento no es válida; aquí se queda dentro. Al guardar, se escapa lo que parecería otro bloque (escapeBlockStarts).
 */
const SafeParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0]?.type === "image") return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    return this.parent!(token, helpers);
  },
  renderMarkdown(node, h, ctx) {
    return escapeBlockStarts(this.parent!(node, h, ctx));
  },
});

/**
 * Lista numerada con el lector de Markdown estándar (CommonMark, el mismo que pinta la descripción guardada). El propio de
 * TipTap tomaba por lista cualquier línea que empezara por una o dos letras y un punto («Sr. García», «Dr. House»,
 * «a) opción») y al guardar se convertían en «1. García» (se perdía el texto); además sangraba de más el código de
 * dentro de un elemento numerado (cada guardado le sumaba un espacio).
 */
const CommonMarkOrderedList = OrderedList.extend({
  markdownTokenizer: null as never,
  // Los elementos, como en la lista con viñetas (ListItem): el lector estándar los da con su formato en línea.
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) return [];
    const start = Number(token.start) || 1;
    // Casilla en una lista numerada («1. [ ] x»): no hay lista de tareas numerada; la casilla se queda como texto.
    type Tok = { type: string; raw?: string; task?: boolean; checked?: boolean; tokens?: Tok[] };
    const items = ((token.items ?? []) as Tok[]).map((item) => {
      if (!item.task) return item;
      const box = item.checked ? "[x] " : "[ ] ";
      const rest = (item.tokens ?? []).filter((t) => t.type !== "checkbox");
      const first = rest[0];
      const lead = { type: "text", raw: box, text: box, escaped: false } as Tok;
      const tokens = first && (first.type === "text" || first.type === "paragraph")
        ? [{ ...first, tokens: [lead, ...(first.tokens ?? [])] }, ...rest.slice(1)]
        : [{ type: "paragraph", raw: box, text: box, tokens: [lead] } as Tok, ...rest];
      return { ...item, task: false, tokens };
    });
    return helpers.createNode("orderedList", start !== 1 ? { start } : undefined, helpers.parseChildren(items as never));
  },
});

/**
 * Formato del editor con barra (TipTap), sin las menciones: StarterKit (títulos, listas, cita, código, regla, enlace,
 * subrayado…) más listas de tareas («- [ ] x»), y tablas e imágenes de Markdown conservadas tal cual. Vive aparte para
 * que los tests comprueben la ida y vuelta con Markdown.
 * Tab / Mayús+Tab sangran y desangran los elementos de lista (ListItem y TaskItem); en el primer elemento, que no se puede
 * sangrar, Tab no hace nada especial y el foco sigue su camino.
 */
export function formatExtensions() {
  return [
    // El subrayado ya viene en StarterKit y se serializa como ++texto++.
    StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false }, code: false, codeBlock: false, paragraph: false, orderedList: false }),
    TrimmedCodeBlock,
    CommonMarkOrderedList,
    SafeParagraph,
    InlineCode,
    TaskList,
    TaskItem.configure({
      nested: true,
      // Etiqueta de la casilla para lectores de pantalla, en el idioma de la página (por defecto sale en inglés).
      a11y: { checkboxLabel: (node) => `${pageIsEnglish() ? "Task" : "Tarea"}: ${node.textContent}` },
    }),
    MarkdownTable,
    MarkdownImage,
  ];
}
