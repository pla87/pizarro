import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY_MARKER } from "../src/lib/markdown-copy";
import { markdownToHtml } from "../src/lib/markdown-html";

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
