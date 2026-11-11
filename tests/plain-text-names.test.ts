import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
// notify importa el cliente de BD; no se conecta hasta la primera consulta.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { makeT } = await import("../src/i18n/core");
const { excerpt } = await import("../src/lib/mentions");
const { markdownToPlain, descriptionToPlain } = await import("../src/lib/ics");
const { mentionEmail } = await import("../src/lib/notify");
const { buildDigest, digestEmail } = await import("../src/lib/digest");
const { cleanFileName } = await import("../src/lib/file-name");
const { normalizeEditorMarkdown } = await import("../src/lib/markdown-entities");

// Así guarda el editor «Devuelve Promise<void> si a<b y b>c & listo»: solo conserva la entidad delante de una letra.
const saved = normalizeEditorMarkdown("Devuelve Promise&lt;void&gt; si a&lt;b y b&gt;c &amp; listo");

test("extracto de avisos y emails: las entidades del editor pasan a su carácter", () => {
  assert.equal(saved, "Devuelve Promise&lt;void> si a&lt;b y b>c & listo");
  assert.equal(excerpt(saved), "Devuelve Promise<void> si a<b y b>c & listo");
  // Descripciones antiguas, con todas las entidades.
  assert.equal(excerpt("x &lt; 3 &amp;&amp; y &gt; 2&nbsp;fin @[Ana](user:abc1)"), "x < 3 && y > 2 fin @Ana");
});

test("texto plano (.ics): no borra lo que hay entre < y > y decodifica las entidades", () => {
  assert.equal(markdownToPlain(saved), "Devuelve Promise<void> si a<b y b>c & listo");
  assert.equal(markdownToPlain("Devuelve Promise<void> si a<b y b>c"), "Devuelve Promise<void> si a<b y b>c");
  assert.equal(descriptionToPlain("etiqueta &lt;div> y x &lt;- y"), "etiqueta <div> y x <- y");
  // Las etiquetas HTML de verdad (texto importado) sí se quitan.
  assert.equal(markdownToPlain("uno<br>dos <b>negrita</b> <span class=\"x\">y</span>"), "unodos negrita y");
  // El código sale tal cual: ni se decodifica ni se le quitan etiquetas.
  assert.equal(markdownToPlain("usa `a &amp;&amp; b` y\n```html\n<p>hola</p>\n```"), "usa a &amp;&amp; b y\n<p>hola</p>");
  // Los escapes del editor (\#, \>, \-, \*, \[ \]) no se quedan con la barra.
  assert.equal(markdownToPlain(normalizeEditorMarkdown("&gt; no es cita")), "> no es cita");
  assert.equal(markdownToPlain("\\# no es título y 2\\*3 y \\*no cursiva\\*"), "# no es título y 2*3 y *no cursiva*");
  assert.equal(markdownToPlain("1. \\[ \\] casilla"), "1. [ ] casilla");
  assert.equal(markdownToPlain("texto ++subrayado++ y c++"), "texto subrayado y c++");
  // Una entidad escapada se queda como texto.
  assert.equal(markdownToPlain("escribe \\&lt; así"), "escribe &lt; así");
});

test("email de aviso: las comillas del título siguen el idioma", () => {
  const msg = { actorName: "Ana", taskTitle: "Portada", projectName: "Web", excerpt: "hola", url: "https://example.com/p/1?task=2" };
  const es = mentionEmail(msg, makeT("es"));
  const en = mentionEmail(msg, makeT("en"));
  assert.equal(es.subject, "Ana te ha mencionado en «Portada»");
  assert.equal(en.subject, "Ana mentioned you in “Portada”");
  assert.ok(en.text.startsWith("Ana mentioned you in “Portada” (Web)"));
  assert.ok(en.html.includes("<strong>“Portada”</strong>") && !en.html.includes("«"));
  // El título sigue escapado en el HTML.
  assert.ok(mentionEmail({ ...msg, taskTitle: "<b>x</b>" }, makeT("en")).html.includes("“&lt;b&gt;x&lt;/b&gt;”"));
});

test("resumen diario en inglés: títulos con comillas inglesas", () => {
  const empty = { assigned: [], overdue: [], dueToday: [], created: [], done: [], comments: [] };
  const digest = buildDigest({ ...empty, assigned: [{ taskId: "t", title: "Portada", projectId: "p", projectName: "Web" }] });
  const mail = digestEmail(digest, { name: "Ana", baseUrl: "https://example.com" }, makeT("en"));
  assert.ok(mail.text.includes("“Portada”") && !mail.text.includes("«"));
});

test("nombre de adjunto: conserva la extensión al recortar y los caracteres normales", () => {
  assert.equal(cleanFileName("informe (final).pdf", "captura"), "informe (final).pdf");
  assert.equal(cleanFileName("a, b & c+d #2.docx", "captura"), "a, b & c+d #2.docx");
  assert.equal(cleanFileName('a\\b/c:d*e?f"g<h>i|j.txt', "captura"), "a_b_c_d_e_f_g_h_i_j.txt");
  assert.equal(cleanFileName("con\ttab\ny\u0007ctrl\u202efdp.exe", "captura"), "con tab yctrlfdp.exe");
  const long = cleanFileName(`${"Informe trimestral ".repeat(10)}.xlsx`, "captura");
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".xlsx") && !long.includes(" .xlsx"));
  const longExt = cleanFileName(`${"a".repeat(200)}.extensionmuylarga`, "captura");
  assert.equal(longExt.length, 120);
  assert.equal(cleanFileName(`${"😀".repeat(100)}.png`, "captura"), `${"😀".repeat(58)}.png`);
  assert.equal(cleanFileName("", "captura"), "captura");
  assert.equal(cleanFileName(" ... ", "captura"), "captura");
  assert.equal(cleanFileName("nota.", "captura"), "nota");
});
