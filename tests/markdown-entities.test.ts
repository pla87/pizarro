import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, normalizeEditorMarkdown } from "../src/lib/markdown-entities";
import { buildReleaseMarkdown } from "../src/lib/release";

test("el editor guarda los caracteres reales", () => {
  assert.equal(normalizeEditorMarkdown("¿Te vale? -&gt; SI"), "¿Te vale? -> SI");
  assert.equal(normalizeEditorMarkdown("a &lt;- b &amp; c"), "a <- b & c");
  assert.equal(normalizeEditorMarkdown("x &lt; 3 &amp;&amp; y &gt;= 2"), "x < 3 && y >= 2");
});

test("solo se conserva lo que cambiaría el Markdown", () => {
  assert.equal(normalizeEditorMarkdown("&gt; no es cita"), "\\> no es cita");
  assert.equal(normalizeEditorMarkdown("- &gt; tampoco"), "- \\> tampoco");
  assert.equal(normalizeEditorMarkdown("etiqueta &lt;div&gt;"), "etiqueta &lt;div>");
  assert.equal(normalizeEditorMarkdown("literal &amp;gt;"), "literal &amp;gt;");
  // El código lo deja TipTap tal cual: una entidad escrita en él es parte del código.
  assert.equal(normalizeEditorMarkdown("`a &lt;b&gt;` y &lt;- b"), "`a &lt;b&gt;` y <- b");
  assert.equal(normalizeEditorMarkdown("```html\n<p>&amp;&nbsp;</p>\n```"), "```html\n<p>&amp;&nbsp;</p>\n```");
});

test("sin párrafos vacíos ni saltos al final (lo que deja el editor tras pegar)", () => {
  assert.equal(normalizeEditorMarkdown("- **a**  \n\n\n"), "- **a**");
  assert.equal(normalizeEditorMarkdown("texto\n\n&nbsp;\n\n&nbsp;"), "texto");
  assert.equal(normalizeEditorMarkdown("&nbsp;"), "");
  assert.equal(normalizeEditorMarkdown("uno\n\n&nbsp;\n\ndos"), "uno\n\n&nbsp;\n\ndos");
  assert.equal(normalizeEditorMarkdown("escrito &amp;nbsp;"), "escrito &amp;nbsp;");
});

test("decodeEntities", () => {
  assert.equal(decodeEntities("-&gt; &lt;- &amp; &quot;x&quot; &#39;y&#39;"), `-> <- & "x" 'y'`);
});

test("la release lleva los caracteres que escribió la persona (también en descripciones antiguas)", () => {
  const md = buildReleaseMarkdown({
    header: "",
    footer: "",
    kinds: [{ id: "k", name: "Mejora" }],
    tasks: [{ id: "t", title: "A -> B", kindId: "k", description: "¿Te vale? -&gt; SI\nx < 3 && y > 2 \"ok\" 'sí' ñ € 😀" }],
  });
  assert.match(md, /A -> B/);
  assert.match(md, /¿Te vale\? -> SI/);
  assert.match(md, /x < 3 && y > 2 "ok" 'sí' ñ € 😀/);
});
