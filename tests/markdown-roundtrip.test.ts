// Ida y vuelta Markdown ↔ TipTap de los formatos de la barra (sin DOM: solo el gestor de Markdown) y su render seguro.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MarkdownManager } from "@tiptap/markdown";
import { formatExtensions } from "../src/lib/editor-extensions";
import { markdownToHtml } from "../src/lib/markdown-html";

const manager = new MarkdownManager({ extensions: formatExtensions() as never });
const roundTrip = (md: string) => manager.serialize(manager.parse(md)).trim();

test("la lista de tareas, anidada, vuelve igual", () => {
  const md = "- [ ] uno\n- [x] dos\n  - [ ] anidada\n  - [x] hecha";
  assert.equal(roundTrip(md), md);
});

test("cita, código en línea, bloque de código, regla y enlace se conservan", () => {
  assert.equal(roundTrip("> una cita"), "> una cita");
  assert.equal(roundTrip("texto con `código` dentro"), "texto con `código` dentro");
  assert.equal(roundTrip("```js\nlet a = 1;\n```"), "```js\nlet a = 1;\n```");
  assert.equal(roundTrip("antes\n\n---\n\ndespués"), "antes\n\n---\n\ndespués");
  assert.equal(roundTrip("[enlace](https://example.com)"), "[enlace](https://example.com)");
});

test("sangría de listas: viñetas y numeradas anidadas se conservan", () => {
  assert.equal(roundTrip("- a\n  - b\n    - c"), "- a\n  - b\n    - c");
  assert.equal(roundTrip("1. a\n   1. b"), "1. a\n   1. b");
});

test("el render seguro (HTML de «Copiar descripción») admite casillas, citas, código y regla", () => {
  const html = markdownToHtml("- [x] hecho\n- [ ] falta\n\n> cita\n\n```\ncódigo\n```\n\n---\n\n`en línea`", "https://example.com");
  assert.match(html, /<input[^>]*type="checkbox"/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /<hr/);
  assert.match(html, /<code>en línea<\/code>/);
});

test("el render seguro no deja pasar HTML ni enlaces peligrosos", () => {
  const html = markdownToHtml("<script>alert(1)</script>\n\n[x](javascript:alert(1))", "https://example.com");
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /javascript:/);
});
