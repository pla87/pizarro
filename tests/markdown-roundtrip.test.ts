// Ida y vuelta Markdown ↔ TipTap de los formatos de la barra (sin DOM: solo el gestor de Markdown) y su render seguro.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { escapeBlockStarts, formatExtensions, tableRows } from "../src/lib/editor-extensions";
import { MentionChip } from "../src/lib/editor-mention";
import { normalizeEditorMarkdown } from "../src/lib/markdown-entities";
import { markdownToHtml } from "../src/lib/markdown-html";

const manager = new MarkdownManager({ extensions: formatExtensions() as never });
const roundTrip = (md: string) => manager.serialize(manager.parse(md)).trim();

test("la lista de tareas, anidada, vuelve igual", () => {
  const md = "- [ ] uno\n- [x] dos\n  - [ ] anidada\n  - [x] hecha";
  assert.equal(roundTrip(md), md);
});

test("cita, código en línea, bloque de código, regla y enlace se conservan", () => {
  assert.equal(roundTrip("> una cita"), "> una cita");
  assert.equal(roundTrip("texto con `código` dentro"), "texto con `código` dentro");
  assert.equal(roundTrip("```js\nlet a = 1;\n```"), "```js\nlet a = 1;\n```");
  assert.equal(roundTrip("antes\n\n---\n\ndespués"), "antes\n\n---\n\ndespués");
  assert.equal(roundTrip("[enlace](https://example.com)"), "[enlace](https://example.com)");
});

test("sangría de listas: viñetas y numeradas anidadas se conservan", () => {
  assert.equal(roundTrip("- a\n  - b\n    - c"), "- a\n  - b\n    - c");
  assert.equal(roundTrip("1. a\n   1. b"), "1. a\n   1. b");
});

test("el render seguro (HTML de «Copiar descripción») admite casillas, citas, código y regla", () => {
  const html = markdownToHtml("- [x] hecho\n- [ ] falta\n\n> cita\n\n```\ncódigo\n```\n\n---\n\n`en línea`", "https://example.com");
  assert.match(html, /<input[^>]*type="checkbox"/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /<hr/);
  assert.match(html, /<code>en línea<\/code>/);
});

test("el render seguro no deja pasar HTML ni enlaces peligrosos", () => {
  const html = markdownToHtml("<script>alert(1)</script>\n\n[x](javascript:alert(1))", "https://example.com");
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /javascript:/);
});

// --- Lo que el editor guarda de verdad: el documento pasa por el esquema (como al pegar o abrir), y la salida por
// normalizeEditorMarkdown (como en onUpdate). `check()` es lo que lanzaba al pegar Markdown con código dentro de una negrita.
const editorExtensions = [...formatExtensions(), MentionChip] as never;
const full = new MarkdownManager({ extensions: editorExtensions });
const schema = getSchema(editorExtensions);
const toDoc = (md: string) => {
  const node = schema.nodeFromJSON(full.parse(md));
  node.check();
  return node;
};
const saved = (md: string) => normalizeEditorMarkdown(full.serialize(toDoc(md).toJSON())).trim();

test("R42C1: una lista con negrita y código en línea dentro se pega (cabe en el documento) y se guarda igual", () => {
  const md = "* **Guardado Local en Borrador (`localStorage`):**";
  const doc: JSONContent = toDoc(md).toJSON();
  const text = doc.content?.[0]?.content?.[0]?.content?.[0]?.content ?? [];
  assert.equal(doc.content?.[0]?.type, "bulletList");
  assert.deepEqual(text.find((n) => n.text === "localStorage")?.marks?.map((m) => m.type).sort(), ["bold", "code"]);
  assert.equal(saved(md), "- **Guardado Local en Borrador (`localStorage`):**");
});

test("el código en línea convive con cursiva, tachado, subrayado y enlaces", () => {
  for (const md of ["*cursiva `x`*", "~~tachado `x`~~", "++sub `x`++", "[`npm`](https://example.com)", "**a `b` c** y [`x` **y**](https://example.com)", "> **Nota (`x`):** algo", "1. **Paso (`npm i`)**"]) {
    assert.equal(saved(md), md, md);
  }
});

test("las tablas y las imágenes de Markdown se conservan tal cual (antes el editor con barra las borraba)", () => {
  const table = "| a | b \\| c |\n|:-|-:|\n| `1` | **2** |";
  assert.equal(saved(`antes\n\n${table}\n\ndespués`), `antes\n\n${table}\n\ndespués`);
  assert.equal(saved("![captura](/api/attachments/abc)"), "![captura](/api/attachments/abc)");
  assert.equal(saved("texto ![a](/api/attachments/x) y ![b](https://example.com/b.png)"), "texto ![a](/api/attachments/x) y ![b](https://example.com/b.png)");
  assert.deepEqual(tableRows(table), [["a", "b | c"], ["`1`", "**2**"]]);
});

test("una línea que empieza por una abreviatura no es una lista numerada («Sr.», «Dr.», «a)»)", () => {
  for (const md of ["Sr. García vino hoy", "Dr. House", "a) opción uno\nb) opción dos"]) assert.equal(saved(md), md, md);
  assert.equal(saved("3. tres\n4. *cuatro*"), "3. tres\n4. *cuatro*");
});

test("el código dentro de un elemento numerado no gana sangría en cada guardado", () => {
  const md = "1. uno\n   ```js\n   x()\n   ```\n2. dos";
  assert.equal(saved(md), md);
  assert.equal(saved(saved(md)), md);
  assert.equal(saved("1. [ ] casilla en numerada"), "1. \\[ \\] casilla en numerada");
});

test("lo escapado al principio de línea sigue escapado (no se convierte en título, lista ni regla)", () => {
  for (const md of ["\\# no es título", "2026\\. Año", "\\- no lista", "\\+ tampoco", "a\n\\===", "\\---", "#hashtag sin espacio"]) assert.equal(saved(md), md, md);
  assert.equal(escapeBlockStarts("# a\n- b\n1. c\n---\nok"), "\\# a\n\\- b\n1\\. c\n\\---\nok");
});

test("las entidades escritas dentro de código no se convierten en caracteres", () => {
  assert.equal(saved("usa `&nbsp;` y `&lt;b&gt;`"), "usa `&nbsp;` y `&lt;b&gt;`");
  assert.equal(saved("```html\n<p>&amp;&lt;</p>\n```"), "```html\n<p>&amp;&lt;</p>\n```");
});
