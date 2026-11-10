// Guías de conexión de la web getpizarro.com: el conversor de Markdown (src/lib/site-markdown.ts) y los ficheros
// docs/guias/*.md con su versión en inglés (scripts/build-site.mjs genera una página por cada uno).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { inlineMarkdown, markdownToHtml, parseGuide } from "../src/lib/site-markdown";

describe("Markdown de la web", () => {
  test("escapa el HTML y solo admite enlaces http(s) y anclas", () => {
    const html = markdownToHtml('Hola <script>alert(1)</script> <img src=x onerror="y"> [mal](javascript:alert) [comillas](https://example.com/"x) [bien](https://example.com/a?b=1&c=2) [ancla](#paso) ![foto](https://example.com/x.png)');
    assert.doesNotMatch(html, /<script|<img|href="javascript|onerror="|example\.com\/"/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener">bien<\/a>/);
    assert.match(html, /<a href="#paso">ancla<\/a>/);
    assert.match(html, / mal comillas /);
    assert.match(html, / foto<\/p>$/);
    assert.equal(markdownToHtml("<!-- nota interna -->\nTexto"), "<p>Texto</p>");
  });

  test("encabezados, listas anidadas, código, citas y tablas", () => {
    const md = [
      "## Paso 1",
      "",
      "1. **Uno** con `APP_URL` y _cursiva_",
      "   - sub <b>",
      "2. Dos",
      "",
      "```",
      "a < b && c",
      "```",
      "",
      "> Nota",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | `x|y` |",
    ].join("\n");
    const html = markdownToHtml(md);
    assert.match(html, /<h2 id="paso-1">Paso 1<\/h2>/);
    assert.match(html, /<ol><li><strong>Uno<\/strong> con <code>APP_URL<\/code> y <em>cursiva<\/em>\n<ul><li>sub &lt;b&gt;<\/li><\/ul><\/li><li>Dos<\/li><\/ol>/);
    assert.match(html, /<pre><code>a &lt; b &amp;&amp; c<\/code><\/pre>/);
    assert.match(html, /<blockquote><p>Nota<\/p><\/blockquote>/);
    assert.match(html, /<th>A<\/th>/);
    assert.equal(inlineMarkdown("snake_case_name"), "snake_case_name");
  });

  test("cabecera de una guía: front-matter, comentarios o el primer título", () => {
    const fm = parseGuide("---\ntitulo: Avisos\ndescripcion: \"Una frase.\"\norden: 3\nicono: send\n---\n\n# Avisos\n\nCuerpo.");
    assert.deepEqual({ ...fm }, { title: "Avisos", description: "Una frase.", order: 3, icon: "send", body: "Cuerpo." });
    const comment = parseGuide("<!-- orden: 2 -->\n# Título **fuerte**\n\nPrimer párrafo con [enlace](https://example.com).\n\n## Paso");
    assert.equal(comment.title, "Título fuerte");
    assert.equal(comment.order, 2);
    assert.equal(comment.description, "Primer párrafo con enlace.");
    assert.equal(parseGuide("# Sin orden\n\nTexto").order, 1000);
  });
});

describe("guías de docs/guias", () => {
  const list = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  test("cada guía tiene su versión en inglés, título y descripción", () => {
    const es = list("docs/guias");
    assert.deepEqual(list("docs/guias/en"), es);
    for (const name of ["google-login.md", "google-docs.md", "telegram.md", "whatsapp.md"]) assert.ok(es.includes(name), name);
    for (const file of [...es.map((f) => `docs/guias/${f}`), ...es.map((f) => `docs/guias/en/${f}`)]) {
      const g = parseGuide(readFileSync(file, "utf8"));
      assert.ok(g.title && g.description, file);
      assert.match(file, /\/[a-z0-9]+(-[a-z0-9]+)*\.md$/);
    }
  });
});
