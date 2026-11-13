import assert from "node:assert/strict";
import { test } from "node:test";
import { blankEmptyParagraphs, decodeEntities, normalizeEditorMarkdown } from "../src/lib/markdown-entities";
import { markdownToPlain } from "../src/lib/ics";
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

test("párrafos vacíos del editor con barra («&nbsp;»): una línea en blanco al leerlos fuera de Pizarro", () => {
  // Varios seguidos (TipTap: el primero como línea en blanco de más, los demás como «&nbsp;»): una sola línea en blanco.
  assert.equal(blankEmptyParagraphs("uno\n\n\n\n&nbsp;\n\n&nbsp;\n\ndos\n"), "uno\n\ndos\n");
  // Al principio y al final del texto, ninguna; el salto final del texto se conserva.
  assert.equal(blankEmptyParagraphs("&nbsp;\n\nuno\n\n&nbsp;\n"), "uno\n");
  assert.equal(blankEmptyParagraphs("\u00a0\n\nuno"), "uno");
  // Dentro de una cita, con su «>».
  assert.equal(blankEmptyParagraphs("> a\n>\n> &nbsp;\n>\n> b"), "> a\n>\n> b");
  // En los bloques de código no se toca nada (ni el «&nbsp;» ni las líneas en blanco).
  const code = "x\n\n```html\n<p>&nbsp;</p>\n\n&nbsp;\n\n\ny\n```\n\n~~~\n&nbsp;\n~~~\n\n&nbsp;\n\nz";
  assert.equal(blankEmptyParagraphs(code), "x\n\n```html\n<p>&nbsp;</p>\n\n&nbsp;\n\n\ny\n```\n\n~~~\n&nbsp;\n~~~\n\nz");
  // Un «&nbsp;» dentro de una línea con texto es un espacio que escribió la persona: no se toca.
  assert.equal(blankEmptyParagraphs("a&nbsp;b\n\n&nbsp;\n\nc"), "a&nbsp;b\n\nc");
});

test("párrafos vacíos: sin «&nbsp;» el texto sale idéntico (salvo con `all`, para lo que acaba de escribir el editor)", () => {
  const typed = "# Notas\n\n\n\nvarias líneas en blanco a propósito\n\n\n- a\n\n  \n\n  b\n";
  assert.equal(blankEmptyParagraphs(typed), typed);
  assert.equal(blankEmptyParagraphs(typed, { all: true }), "# Notas\n\nvarias líneas en blanco a propósito\n\n- a\n\n  b\n");
  assert.equal(blankEmptyParagraphs("```\na\n\n\nb\n```", { all: true }), "```\na\n\n\nb\n```");
});

test("cabecera o pie de la release guardados con párrafos vacíos: sin «&nbsp;» ni líneas con un espacio", () => {
  const md = buildReleaseMarkdown({
    header: "Hola equipo\n\n&nbsp;\n\n&nbsp;\n\nNovedades:",
    footer: "Gracias\n\n&nbsp;\n\nEl equipo",
    kinds: [{ id: "k", name: "Mejora" }],
    tasks: [{ id: "t", title: "Algo", kindId: "k", description: "Línea\n\n&nbsp;\n\n&nbsp;\n\nOtra" }],
  });
  assert.equal(md, "Hola equipo\n\nNovedades:\n\n### Mejora\n- **M1** · Algo\n  Línea\n\n  Otra\n\nGracias\n\nEl equipo\n");
});

test("descripción en el .ics: los párrafos vacíos del editor no dejan «&nbsp;» ni líneas en blanco repetidas", () => {
  assert.equal(markdownToPlain("uno\n\n\n\n&nbsp;\n\n&nbsp;\n\ndos `&nbsp;`\n\n> &nbsp;\n\n- a\n\n  \n\n  b"), "uno\n\ndos &nbsp;\n\n- a\n\n  b");
});
