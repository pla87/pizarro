import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlainWrapperHtml, looksLikeMarkdown, markdownFromPaste } from "../src/lib/markdown-paste";

const MD = "## Título\n\n- uno\n- **dos**";

test("looksLikeMarkdown: detecta Markdown y descarta prosa", () => {
  assert.equal(looksLikeMarkdown(MD), true);
  assert.equal(looksLikeMarkdown("Hola, esto es un texto normal."), false);
});

test("HTML de Gboard (div por línea) cuenta como texto plano", () => {
  const html = "<div>## Título</div><div><br></div><div>- uno</div><div>- **dos**</div>";
  assert.equal(isPlainWrapperHtml(html), true);
  assert.equal(markdownFromPaste(MD, html), MD);
});

test("HTML de iOS (span con estilo) cuenta como texto plano", () => {
  const html = '<span style="font-family: -apple-system; font-size: 17px; color: rgb(0, 0, 0);">## Título<br>- uno<br>- **dos**</span>';
  assert.equal(isPlainWrapperHtml(html), true);
  assert.equal(markdownFromPaste(MD, html), MD);
});

test("prefijo <meta charset> y comentarios de fragmento se ignoran", () => {
  assert.equal(isPlainWrapperHtml('<meta charset="utf-8"><p>- uno</p>'), true);
  assert.equal(isPlainWrapperHtml("<html><body><!--StartFragment--><span>- uno</span><!--EndFragment--></body></html>"), true);
});

test("HTML con formato real mantiene la ruta HTML", () => {
  for (const html of [
    "<ul><li>uno</li></ul>",
    "<h2>Título</h2>",
    '<a href="https://example.com">enlace</a>',
    "<strong>dos</strong>",
    "<em>dos</em>",
    "<code>x</code>",
    "<table><tr><td>a</td></tr></table>",
    '<img src="x.png">',
    '<meta charset="utf-8"><b>negrita</b>',
    '<span style="font-weight: 700">negrita</span>',
    '<span style="font-style:italic">cursiva</span>',
  ]) {
    assert.equal(isPlainWrapperHtml(html), false, html);
    assert.equal(markdownFromPaste(MD, html), null, html);
  }
});

test("sin HTML o sin aspecto de Markdown", () => {
  assert.equal(markdownFromPaste(MD, ""), MD);
  assert.equal(markdownFromPaste("texto normal", "<div>texto normal</div>"), null);
  assert.equal(markdownFromPaste("", "<div>- uno</div>"), null);
});
