// Guías de conexión de la web getpizarro.com: el conversor de Markdown (src/lib/site-markdown.ts) y los ficheros
// docs/guias/*.md con su versión en inglés (scripts/build-site.mjs genera una página por cada uno).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
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
    // El código dentro de la negrita no la rompe, y lo de dentro del código no se interpreta.
    assert.equal(inlineMarkdown("**Elige la rama `stable`.** y `**x**`"), "<strong>Elige la rama <code>stable</code>.</strong> y <code>**x**</code>");
    assert.equal(inlineMarkdown("[ver `a`](https://example.com) [mal](https://example.com/`x`)"), '<a href="https://example.com" rel="noopener">ver <code>a</code></a> mal');
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

  test("identificador fijo de un encabezado, avisos al estilo de GitHub y bloques de código a medida", () => {
    const headings: { level: number; id: string; html: string }[] = [];
    const md = [
      "## Actualizar `get.sh` {#actualizar}",
      "",
      "## Actualizar `get.sh` {#actualizar}",
      "",
      "> [!IMPORTANT]",
      "> Guarda el **kit**.",
      ">",
      "> ```bash",
      "> cat kit.txt",
      "> ```",
      "",
      "> [!tip]",
      "> Consejo <b>",
      "",
      "> [!RARO]",
      "> cita normal",
      "",
      "```text",
      "a < b",
      "```",
    ].join("\n");
    const html = markdownToHtml(md, { headings, callouts: { tip: "Tip" }, code: (text, lang) => `<pre data-lang="${lang}">${text.replace(/</g, "&lt;")}</pre>` });
    assert.match(html, /<h2 id="actualizar">Actualizar <code>get\.sh<\/code><\/h2>/);
    assert.match(html, /<h2 id="actualizar-2">/);
    assert.deepEqual(headings.map((h) => h.id), ["actualizar", "actualizar-2"]);
    assert.match(html, /<div class="callout callout-important" role="note"><p class="callout-title">Importante<\/p><p>Guarda el <strong>kit<\/strong>\.<\/p>\n<pre data-lang="bash">cat kit\.txt<\/pre><\/div>/);
    assert.match(html, /<div class="callout callout-tip" role="note"><p class="callout-title">Tip<\/p><p>Consejo &lt;b&gt;<\/p><\/div>/);
    assert.match(html, /<blockquote><p>\[!RARO\] cita normal<\/p><\/blockquote>/);
    assert.match(html, /<pre data-lang="text">a &lt; b<\/pre>/);
    // Sin `code`, como siempre; un «{#id}» no válido se queda en el texto.
    assert.equal(markdownToHtml("```bash\nx\n```"), "<pre><code>x</code></pre>");
    assert.match(markdownToHtml("## Hola {#Mal id}"), /<h2 id="hola-mal-id">Hola \{#Mal id\}<\/h2>/);
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

describe("guía de instalación de la web (docs/web)", () => {
  // Las anclas que enlazan la portada (#railway, #email), la app (UPDATE_DOCS_URL) y las notas de cada versión.
  const anchors = { "docs/web/instalar.md": ["railway", "email", "actualizar"], "docs/web/en/install.md": ["railway", "email", "update"] };
  test("existe en español y en inglés, con título, descripción, las mismas secciones y sus anclas fijas", () => {
    const sections: number[] = [];
    for (const [file, ids] of Object.entries(anchors)) {
      const g = parseGuide(readFileSync(file, "utf8"));
      assert.ok(g.title && g.description, file);
      const headings: { level: number; id: string; html: string }[] = [];
      markdownToHtml(g.body, { headings, link: () => "#" });
      for (const id of ids) assert.ok(headings.some((h) => h.id === id), `${file}: falta {#${id}}`);
      sections.push(headings.filter((h) => h.level === 2).length);
      // Cada sección principal lleva su identificador fijo (no depende de cómo se traduzca el título).
      for (const line of g.body.split("\n").filter((l) => l.startsWith("## "))) assert.match(line, /\{#[a-z0-9-]+\}$/, `${file}: ${line}`);
    }
    assert.equal(sections[0], sections[1]);
  });

  test("la app y las notas de versión enlazan a la web, no a docs/INSTALL.md en GitHub", async () => {
    const product = await import("../src/lib/product");
    assert.equal(product.INSTALL_URL, "https://getpizarro.com/instalar/");
    assert.equal(product.installUrl("en"), "https://getpizarro.com/en/install/");
    assert.equal(product.installUrl("es"), product.INSTALL_URL);
    const update = await import("../src/lib/update-check-core");
    assert.equal(update.updateDocsUrl("es"), "https://getpizarro.com/instalar/#actualizar");
    assert.equal(update.updateDocsUrl("en"), "https://getpizarro.com/en/install/#update");
    assert.match(readFileSync("docs/INSTALL.md", "utf8").split("\n").slice(0, 4).join("\n"), /https:\/\/getpizarro\.com\/instalar\//);
  });
});

test("workflow de la web: se lanza al cambiar cualquier módulo que carga build-site.mjs (también los que importan esos)", () => {
  const paths = [...readFileSync(".github/workflows/site.yml", "utf8").matchAll(/^ {6}- "([^"]+)"$/gm)].map((m) => m[1]!);
  const covered = (file: string) => paths.some((p) => (p.endsWith("/**") ? file.startsWith(p.slice(0, -2)) : p.includes("*") ? new RegExp(`^${p.replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`).test(file) : p === file));
  const pending = [...readFileSync("scripts/build-site.mjs", "utf8").matchAll(/imp\("(src\/[^"]+\.ts)"\)/g)].map((m) => m[1]!);
  assert.ok(pending.length >= 4, "build-site.mjs carga los módulos con imp(\"src/…\")");
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(covered(file), `${file} no está en paths de .github/workflows/site.yml`);
    // Solo los imports que existen al ejecutar (los «import type» desaparecen).
    for (const m of readFileSync(file, "utf8").matchAll(/^import (?!type\b)[^;]*? from "(\.\.?\/[^"]+)";/gm)) {
      const target = posix.normalize(posix.join(posix.dirname(file), m[1]!));
      pending.push(target.endsWith(".ts") ? target : `${target}.ts`);
    }
  }
  assert.ok(seen.has("src/lib/html-escape.ts"));
});
