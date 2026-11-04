import { Node, mergeAttributes } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { Paragraph } from "@tiptap/extension-paragraph";
import { OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";

/** Idioma de la página (las vistas del editor se pintan fuera de React y no tienen `t`). */
const pageIsEnglish = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("en");

/**
 * Código en línea que convive con negrita, cursiva, tachado, subrayado y enlaces (`**`x`**`, `[`npm`](url)`).
 * El de TipTap excluye cualquier otra marca: el Markdown con código dentro de una negrita o de un enlace no cabía en el
 * documento y pegarlo (o abrirlo) lanzaba «Invalid collection of marks for node text: bold,code» sin pegar nada.
 */
export const InlineCode = Code.extend({ excludes: "code" });

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
export const MarkdownTable = Node.create({
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

/**
 * Imagen de Markdown (`![texto](/api/attachments/…)`): se ve en el editor si es un adjunto (como en la descripción
 * guardada) y se guarda con el texto original. Sin este nodo el editor con barra la convertía en su texto alternativo.
 */
export const MarkdownImage = Node.create({
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
          return { raw: e.getAttribute("data-md-image") ?? "", src: e.getAttribute("data-src") ?? "", alt: e.getAttribute("data-alt") ?? "" };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { raw, src, alt } = node.attrs as { raw: string; src: string; alt: string };
    const data = { "data-md-image": raw, "data-src": src, "data-alt": alt };
    if (src.startsWith("/api/attachments/")) return ["img", mergeAttributes(HTMLAttributes, data, { src, alt, class: "max-w-full rounded" })];
    return ["span", mergeAttributes(HTMLAttributes, data, { class: "text-slate-400" }), `[${pageIsEnglish() ? "image" : "imagen"}: ${alt}]`];
  },
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) =>
    helpers.createNode("markdownImage", { raw: String(token.raw ?? ""), src: String(token.href ?? ""), alt: String(token.text ?? "") }),
  renderMarkdown: (node) => {
    const { raw, src, alt } = (node.attrs ?? {}) as { raw?: string; src?: string; alt?: string };
    return raw || `![${String(alt ?? "").replace(/[[\]]/g, "\\$&")}](${src ?? ""})`;
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
    StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false }, code: false, paragraph: false, orderedList: false }),
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
