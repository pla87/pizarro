import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY_MARKER } from "../src/lib/markdown-copy";
import { escapeHtml } from "../src/lib/html-escape";
import { markdownToHtml } from "../src/lib/markdown-html";
import { markdownToHtml as siteMarkdownToHtml } from "../src/lib/site-markdown";

test("markdownToHtml conserva negrita, listas, títulos, subrayado y menciones, y marca el origen", () => {
  const html = markdownToHtml("## Título\n\n**negrita** y ++sub++\n\n- uno\n- dos\n\nHola @[Ana](user:abc1)");
  assert.ok(html.includes(COPY_MARKER));
  assert.match(html, /<h2>Título<\/h2>/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<u>sub<\/u>/);
  assert.match(html, /<ul>[\s\S]*<li>uno<\/li>/);
  assert.match(html, /<strong>@Ana<\/strong>/);
});

test("markdownToHtml no deja pasar HTML en bruto y pone ruta absoluta a los adjuntos", () => {
  const html = markdownToHtml("<script>alert(1)</script>\n\n![x](/api/attachments/a1)", "https://app.example.com");
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes('src="https://app.example.com/api/attachments/a1"'));
});

test("escapeHtml (el mismo en emails, portapapeles y web): también la comilla simple", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  const img = markdownToHtml("![it's \"x\"](/api/attachments/a1)", "https://app.example.com");
  assert.ok(img.includes('alt="it&#39;s &quot;x&quot;"'), img);
  assert.equal(siteMarkdownToHtml("Pizarro's <b>"), "<p>Pizarro&#39;s &lt;b&gt;</p>");
});
