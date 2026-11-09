// Tablas pegadas como HTML (Word, Google Docs, una web) → tabla Markdown, y el resto del HTML sin tocar.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MarkdownManager } from "@tiptap/markdown";
import { formatExtensions, tableRows } from "../src/lib/editor-extensions";
import { markdownToHtml } from "../src/lib/markdown-html";
import { cellMarkdown, escapeCellText, htmlTableToMarkdown, markdownTablePlaceholder, replaceHtmlTables, tablesOnlyMarkdown } from "../src/lib/paste-table";

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", "paste", name), "utf8");
/** Tablas que salen de un HTML pegado, y el HTML con «[[T]]» en su lugar. */
function convert(html: string) {
  const tables: string[] = [];
  const rest = replaceHtmlTables(html, (md) => {
    tables.push(md);
    return "[[T]]";
  });
  return { tables, rest };
}
const manager = new MarkdownManager({ extensions: formatExtensions() as never });

test("Word: mso-*, <o:p>, comentarios condicionales, viñetas de Word y fila oculta de columnas desalineadas", () => {
  const { tables, rest } = convert(fixture("word.html"));
  assert.equal(tables.length, 1);
  assert.equal(
    tables[0],
    [
      "| Tarea | Responsable | Estado |",
      "| --- | --- | --- |",
      "| Revisar el *presupuesto* \\| v2 | Ana Luis | Pendiente |",
      "| Ver [el documento](https://example.com/doc) |  | Hecho |",
    ].join("\n"),
  );
  // Lo de alrededor sigue ahí, igual (el editor lo pega como siempre).
  assert.match(rest, /Resumen de la reunión:<o:p><\/o:p><\/p>\s*\[\[T\]\]\s*<p class=MsoNormal><o:p>&nbsp;<\/o:p><\/p>/);
  assert.match(rest, /Siguiente paso: <b>enviar<\/b> el resumen\./);
  assert.match(rest, /<style>[\s\S]*Font Definitions[\s\S]*<\/style>/);
});

test("Google Docs: el <b style=font-weight:normal> que lo envuelve todo no es negrita; sí los span con font-weight:700", () => {
  const { tables, rest } = convert(fixture("gdocs.html"));
  assert.deepEqual(tables, [
    [
      "| Día | Objetivo |",
      "| --- | --- |",
      "| Lunes | Cerrar la *release* 1.2 |",
      "| Martes | [Informe](https://example.com/informe) para **dirección** (segunda línea) |",
    ].join("\n"),
  ]);
  assert.match(rest, /^<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-[^"]+">/);
  assert.match(rest, /Plan de la semana<\/span><\/p><br \/><div dir="ltr" style="margin-left:0pt;" align="left">\[\[T\]\]<\/div>/);
  assert.match(rest, /Fin del plan\.<\/span><\/p><\/b>\s*$/);
});

test("web: <thead>/<th>, rowspan y colspan rellenos con vacío, <br> como espacio, «|» escapado, tabla anidada aplanada", () => {
  const { tables, rest } = convert(fixture("web.html"));
  assert.deepEqual(tables, [
    [
      "| Plan | Precio | Notas |",
      "| --- | --- | --- |",
      "| Básico | 5 € | Uso *personal* sin soporte |",
      "|  | 50 €/año | Pago anual: a\\|b |",
      "| **Pro** | Consultar en [la web](https://example.com/precios) |  |",
      "| Anidada | x y | \\*no\\* es cursiva |",
    ].join("\n"),
  ]);
  assert.match(rest, /<h2[^>]*>Comparativa<\/h2><p[^>]*>Datos de <a href="\/wiki\/Ejemplo"[^>]*>ejemplo<\/a> por plan:<\/p>\[\[T\]\]<p[^>]*>Precios con IVA\.<\/p>/);
});

test("la tabla generada se lee como tabla: celdas iguales en el editor (tableRows), en el gestor Markdown y en el render", () => {
  for (const name of ["word.html", "gdocs.html", "web.html"]) {
    const [md] = convert(fixture(name)).tables;
    const rows = tableRows(md!);
    const width = rows[0]!.length;
    assert.ok(rows.every((r) => r.length === width), `${name}: todas las filas con ${width} celdas`);
    const doc = manager.parse(`Antes\n\n${md}\n\nDespués`);
    assert.deepEqual(doc.content?.map((n) => n.type), ["paragraph", "markdownTable", "paragraph"], name);
    assert.equal(doc.content?.[1]?.attrs?.raw, md, `${name}: se guarda tal cual`);
    assert.equal(manager.serialize(doc).trim(), `Antes\n\n${md}\n\nDespués`);
    const html = markdownToHtml(md!);
    assert.match(html, /<table>[\s\S]*<th>[\s\S]*<td>/, `${name}: se pinta como tabla`);
  }
  // El «|» escapado no parte la celda al pintarla.
  assert.match(markdownToHtml(convert(fixture("web.html")).tables[0]!), /<td>Pago anual: a\|b<\/td>/);
});

test("primera fila como cabecera sin <th>; la fila de <th> manda si existe", () => {
  assert.equal(htmlTableToMarkdown("<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>"), "| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(
    htmlTableToMarkdown("<table><tr><td>1</td><td>2</td></tr><tr><th>A</th><th>B</th></tr><tr><td>3</td><td>4</td></tr></table>"),
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
  );
  // Celdas sin cerrar (HTML válido) y filas más cortas que otras.
  assert.equal(htmlTableToMarkdown("<table><tr><td>a<td>b<td>c<tr><td>1</table>"), "| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |");
});

test("celdas combinadas: rowspan y colspan a la vez", () => {
  const html = '<table><tr><th colspan="2" rowspan="2">X</th><th>Y</th></tr><tr><td>y1</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>';
  assert.equal(htmlTableToMarkdown(html), "| X |  | Y |\n| --- | --- | --- |\n|  |  | y1 |\n| a | b | c |");
  // Un colspan disparatado no cuelga nada.
  assert.equal(htmlTableToMarkdown('<table><tr><td colspan="99999">a</td></tr><tr><td>b</td></tr></table>')?.split("\n")[1]?.split("---").length, 101);
});

test("no son tablas: una sola celda (caja de maquetación) o vacía; se dejan como estaban", () => {
  const box = "<p>x</p><table><tr><td><p>Hola</p></td></tr></table>";
  assert.equal(replaceHtmlTables(box), box);
  const empty = "<table><tr><td> </td><td>&nbsp;</td></tr></table>";
  assert.equal(replaceHtmlTables(empty), empty);
  assert.equal(replaceHtmlTables("<p>sin tablas</p>"), "<p>sin tablas</p>");
});

test("varias tablas y texto entre medias; el marcador lleva el Markdown para el editor", () => {
  const html = "<p>uno</p><table><tr><td>a</td><td>b</td></tr></table><p>dos</p><table><tr><td>c</td></tr><tr><td>d</td></tr></table>";
  const out = replaceHtmlTables(html);
  assert.equal(
    out,
    `<p>uno</p>${markdownTablePlaceholder("| a | b |\n| --- | --- |")}<p>dos</p>${markdownTablePlaceholder("| c |\n| --- |\n| d |")}`,
  );
  assert.equal(markdownTablePlaceholder('| "<a>" & b |'), '<table data-md-table="| &quot;&lt;a&gt;&quot; &amp; b |"></table>');
  assert.equal(markdownTablePlaceholder("| a |\n| --- |"), '<table data-md-table="| a |&#10;| --- |"></table>');
});

test("formato en celdas: negrita, cursiva, tachado, código y enlaces; espacios fuera de las marcas", () => {
  const md = htmlTableToMarkdown(
    '<table><tr><th>h</th><th>i</th></tr><tr><td><b>negrita </b>y <i>cursiva</i></td><td><s>no</s> <code>a|b</code> <a href="https://example.com/a b">enlace</a></td></tr></table>',
  );
  assert.equal(md, "| h | i |\n| --- | --- |\n| **negrita** y *cursiva* | ~~no~~ `a\\|b` [enlace](<https://example.com/a%20b>) |");
  // Enlaces relativos o peligrosos: solo el texto.
  assert.equal(
    htmlTableToMarkdown('<table><tr><td><a href="/wiki/x">rel</a></td><td><a href="javascript:alert(1)">js</a></td></tr></table>'),
    "| rel | js |\n| --- | --- |",
  );
  // Cabecera toda en negrita: sin «**» (ya se ve en negrita); en parte, se conserva.
  assert.equal(htmlTableToMarkdown("<table><tr><td><b>A</b></td><td><b>B</b> b</td></tr><tr><td>1</td><td>2</td></tr></table>")?.split("\n")[0], "| A | **B** b |");
});

test("texto de celda: blancos como en HTML, entidades, escapes de Markdown", () => {
  assert.equal(cellMarkdown([{ text: "  a \n\t b  " }]), "a b");
  assert.equal(escapeCellText("a|b *c* `d` [e] _f_ snake_case ~g~ <h> C:\\ruta \\* &amp;"), "a\\|b \\*c\\* \\`d\\` \\[e\\] \\_f\\_ snake_case \\~g\\~ \\<h> C:\\ruta \\\\\\* \\&amp;");
  assert.equal(htmlTableToMarkdown("<table><tr><td>&lt;b&gt; &amp; &#169; &#xe9;</td><td>x</td></tr></table>")?.split("\n")[0], "| \\<b> & © é | x |");
});

test("HTML sucio: atributos con «>» entre comillas, imágenes en base64, <style> y comentarios dentro de la tabla", () => {
  const big = "A".repeat(20000);
  const html = `<table data-x="a>b"><!-- nota --><style>td{color:red}</style><tr><td><img src="data:image/png;base64,${big}" alt="foto">uno</td><td title='x>y'>dos</td></tr></table>`;
  assert.equal(htmlTableToMarkdown(html), "| uno | dos |\n| --- | --- |");
});

test("modo Markdown: solo se convierte un pegado que es solo tablas (Excel, Google Sheets)", () => {
  const sheets =
    '<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1"><colgroup><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td>Mes</td><td>Total</td></tr><tr style="height:21px;"><td>Enero</td><td style="text-align:right;">1.200</td></tr></tbody></table></google-sheets-html-origin>';
  assert.equal(tablesOnlyMarkdown(sheets), "| Mes | Total |\n| --- | --- |\n| Enero | 1.200 |");
  const excel = '<html><head><meta charset=utf-8><style>td{mso-number-format:General}</style></head><body><!--StartFragment--><table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table><!--EndFragment--></body></html>';
  assert.equal(tablesOnlyMarkdown(excel), "| a | b |\n| --- | --- |\n| 1 | 2 |");
  // Con texto alrededor (Word, una web), el pegado normal del modo Markdown.
  assert.equal(tablesOnlyMarkdown(fixture("word.html")), null);
  assert.equal(tablesOnlyMarkdown(fixture("web.html")), null);
  assert.equal(tablesOnlyMarkdown("<p>sin tablas</p>"), null);
});
