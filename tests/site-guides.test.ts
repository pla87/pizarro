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

  test("énfasis bien anidado (como CommonMark) y «_» dentro de palabras como texto", () => {
    // Antes salía <strong>a <em>b</strong> c</em>: etiquetas cruzadas.
    assert.equal(inlineMarkdown("**a *b** c*"), "<em><em>a <em>b</em></em> c</em>");
    assert.equal(inlineMarkdown("*a **b** c*"), "<em>a <strong>b</strong> c</em>");
    assert.equal(inlineMarkdown("***a***"), "<em><strong>a</strong></em>");
    assert.equal(inlineMarkdown("*a _b* c_"), "<em>a _b</em> c_");
    assert.equal(inlineMarkdown("snake_case_name y _cursiva_."), "snake_case_name y <em>cursiva</em>.");
    assert.equal(inlineMarkdown("**sin cerrar y 2 * 3"), "**sin cerrar y 2 * 3");
    assert.equal(inlineMarkdown("«_a_» **<b>**"), "«<em>a</em>» <strong>&lt;b&gt;</strong>");
    // Cualquier combinación sale con las etiquetas bien cerradas.
    for (const s of ["**a *b** c*", "*a **b c*", "_a *b_ c*", "***a** b*", "**a _b** _c", "a**b*c**d*"]) {
      const tags = [...inlineMarkdown(s).matchAll(/<(\/?)(em|strong)>/g)];
      const stack: string[] = [];
      for (const [, close, tag] of tags) {
        if (!close) stack.push(tag!);
        else assert.equal(stack.pop(), tag, s);
      }
      assert.equal(stack.length, 0, s);
    }
  });

  test("rendimiento: texto hostil en tiempo lineal y anidamiento con tope (sin desbordar la pila)", () => {
    const time = (fn: () => unknown) => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    // « _a» repetido: la regex anterior tardaba ~1 s con 60 KB (cuadrática).
    assert.ok(time(() => inlineMarkdown(" _a".repeat(20_000))) < 400, "« _a» × 20.000");
    assert.ok(time(() => inlineMarkdown("**a ".repeat(15_000))) < 400, "«**a» × 15.000");
    assert.ok(time(() => inlineMarkdown("[".repeat(60_000))) < 400, "«[» × 60.000");
    assert.ok(time(() => inlineMarkdown("*".repeat(60_000) + "a" + "*".repeat(60_000))) < 400, "marcas muy largas");
    // 5.000 «>» o 2.000 niveles de lista: antes, «Maximum call stack size exceeded» (o sin memoria).
    let html = "";
    assert.ok(time(() => (html = markdownToHtml(">".repeat(5_000) + " fondo"))) < 1_000);
    assert.equal(html.match(/<blockquote>/g)?.length, 20);
    assert.match(html, /&gt;&gt;&gt; fondo/);
    assert.ok(time(() => (html = markdownToHtml(Array.from({ length: 2_000 }, (_, i) => `${"  ".repeat(i)}- n${i}`).join("\n")))) < 5_000);
    assert.equal(html.match(/<ul>/g)?.length, 20);
    assert.match(html, /n1999/);
    // Dentro del tope, todo sigue igual.
    assert.equal(markdownToHtml("> > cita\n\n- a\n  - b"), "<blockquote><blockquote><p>cita</p></blockquote></blockquote>\n<ul><li>a\n<ul><li>b</li></ul></li></ul>");
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
