// Ida y vuelta Markdown ↔ TipTap de los formatos de la barra (sin DOM: solo el gestor de Markdown) y su render seguro.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { escapeBlockStarts, formatExtensions, tableRows } from "../src/lib/editor-extensions";
import { MentionChip } from "../src/lib/editor-mention";
import { normalizeEditorMarkdown } from "../src/lib/markdown-entities";
import { markdownToHtml } from "../src/lib/markdown-html";
import { editorMarkdown } from "../src/lib/editor-markdown";

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

test("un bloque sangrado (4 espacios) al final no gana una línea vacía (marked 18 deja el salto final en su texto)", () => {
  for (const md of ["    código", "    código\n", "    código\n\n", "texto\n\n    a\n\n    b\n"]) {
    const block = manager.parse(md).content!.findLast((n) => n.type === "codeBlock");
    assert.ok(block, JSON.stringify(md));
    assert.doesNotMatch(block.content![0]!.text!, /\n$/, JSON.stringify(md));
  }
  assert.equal(roundTrip("    código\n"), "```\ncódigo\n```");
  assert.equal(roundTrip("texto\n\n    a\n\n    b\n"), "texto\n\n```\na\n\nb\n```");
  // Los cercados conservan su texto tal cual (también las líneas vacías del final, que son contenido).
  assert.equal(roundTrip("```\ncódigo\n\n```"), "```\ncódigo\n\n```");
});

test("un bloque cercado que acaba en líneas vacías no gana otra en cada guardado (marked 18.2 añade un salto)", () => {
  // Ida y vuelta completa (Markdown → documento del editor → Markdown) cuatro veces seguidas: como abrir y guardar.
  const cases = [
    "```\ncódigo\n\n```",
    "```js\na\n\n```\n\ntexto",
    "```\na\n\n\n```",
    "texto\n\n```\nb\n\n```\n",
    "~~~\na\n\n~~~",
    "```\n```",
    "```\n\n```",
    "```\n\n\n```",
    "- x\n\n  ```\n  c\n\n  ```",
    "> ```\n> d\n>\n> ```",
    "```\nsin cerrar\n\n",
    "```\na\n  \n```",
  ];
  for (const md of cases) {
    const first = editorMarkdown(md);
    let now = first;
    for (let i = 0; i < 4; i++) now = editorMarkdown(now);
    assert.equal(now, first, JSON.stringify(md));
  }
  // Lo que se conserva: las líneas vacías de dentro, tal cual.
  assert.equal(editorMarkdown("```\ncódigo\n\n```"), "```\ncódigo\n\n```");
  assert.equal(editorMarkdown("```\na\n\n\n```"), "```\na\n\n\n```");
  assert.equal(editorMarkdown("~~~\na\n\n~~~"), "```\na\n\n```");
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

test("el editor solo pinta como <img> las imágenes de un adjunto con la ruta fija (sin «..» ni %2e)", () => {
  const toDOM = schema.nodes.markdownImage!.spec.toDOM!;
  const tag = (md: string) => {
    const doc: JSONContent = toDoc(md).toJSON();
    const img = doc.content?.[0]?.content?.find((n) => n.type === "markdownImage");
    assert.ok(img, md);
    return (toDOM(schema.nodeFromJSON(img)) as unknown as [string])[0];
  };
  assert.equal(tag("![x](/api/attachments/abc?thumb=1)"), "img");
  for (const s of ["/api/attachments/../auth/reset", "/api/attachments/%2e%2e/auth/reset", "/api/attachments/a/b"]) assert.equal(tag(`![x](${s})`), "span", s);
  // Y se guarda igual: el texto no se pierde aunque no se pinte.
  assert.equal(saved("![x](/api/attachments/../auth/reset)"), "![x](/api/attachments/../auth/reset)");
});

test("un bloque cercado con 1 a 3 espacios delante de la valla no se borra al abrir el editor", () => {
  for (const md of ["Texto\n\n  ```\n  npm i\n  ```\n\nfin", " ```js\n a()\n ```", "   ~~~\n   a\n\n   ~~~", "  ```\n  a\n\n  ```"]) {
    const first = editorMarkdown(md);
    assert.match(first, /```/, JSON.stringify(md));
    let now = first;
    for (let i = 0; i < 4; i++) now = editorMarkdown(now);
    assert.equal(now, first, JSON.stringify(md));
  }
  assert.equal(editorMarkdown("Texto\n\n  ```\n  npm i\n  ```\n\nfin"), "Texto\n\n```\nnpm i\n```\n\nfin");
  // La sangría de la valla se quita también a las líneas de dentro con tildes (marked solo lo hace con acentos).
  assert.equal(editorMarkdown("   ~~~\n   a\n\n   ~~~"), "```\na\n\n```");
});

test("un bloque «~~~» o «````» con «```» dentro se guarda con una valla más larga y no se rompe", () => {
  const cases = ["~~~\n```\nx\n```\n~~~", "````\n```\nx\n```\n````", "~~~md\n````js\ny\n````\n~~~", "```\na ``` b\n```"];
  for (const md of cases) {
    const first = editorMarkdown(md);
    let now = first;
    for (let i = 0; i < 4; i++) now = editorMarkdown(now);
    assert.equal(now, first, JSON.stringify(md));
    // Sigue siendo un solo bloque.
    assert.equal(manager.parse(first).content!.filter((n) => n.type === "codeBlock").length, 1, JSON.stringify(md));
  }
  assert.equal(editorMarkdown("~~~\n```\nx\n```\n~~~"), "````\n```\nx\n```\n````");
  assert.equal(editorMarkdown("~~~md\n````js\ny\n````\n~~~"), "`````md\n````js\ny\n````\n`````");
  // Sin vallas dentro, como siempre: tres acentos.
  assert.equal(editorMarkdown("~~~\na ``` b\n~~~"), "```\na ``` b\n```");
});

test("una imagen pegada como HTML solo conserva su Markdown original si es exactamente una imagen", () => {
  const rule = schema.nodes.markdownImage!.spec.parseDOM![0]!;
  type Attrs = { raw: string; src: string; alt: string };
  const attrs = (a: Record<string, string>) =>
    (rule.getAttrs as (e: HTMLElement) => Attrs)({ getAttribute: (k: string) => a[k] ?? null } as unknown as HTMLElement);
  assert.equal(attrs({ "data-md-image": "![captura](/api/attachments/abc)" }).raw, "![captura](/api/attachments/abc)");
  assert.equal(attrs({ "data-md-image": "![a \\[1\\]](/api/attachments/abc)" }).raw, "![a \\[1\\]](/api/attachments/abc)");
  for (const raw of ["@[Ana](user:u1) [clic](https://example.com)", "![a](x) [clic](https://example.com)", "![x [y](z)", "![a](x \"t\")", "![a](x)\n\n# t", "texto"]) {
    assert.equal(attrs({ "data-md-image": raw, "data-alt": "a", "data-src": "/api/attachments/abc" }).raw, "", raw);
  }
  // Sin el original, se vuelve a escribir con el texto y la dirección, sin que estos puedan cerrar la imagen antes.
  const md = (a: Record<string, string>) => {
    const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, schema.nodes.markdownImage!.create(attrs(a))));
    return normalizeEditorMarkdown(full.serialize(doc.toJSON())).trim();
  };
  assert.equal(md({ "data-md-image": "@[Ana](user:u1)", "data-alt": "captura", "data-src": "/api/attachments/abc" }), "![captura](/api/attachments/abc)");
  assert.equal(md({ "data-alt": "a] [b\\", "data-src": "x) @[Ana](user:u1" }), "![a\\] \\[b\\\\](x%29%20@[Ana]%28user:u1)");
});
