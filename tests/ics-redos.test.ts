import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToPlain } from "../src/lib/ics";

// Entradas preparadas contra las expresiones de markdownToPlain: cada una debe convertirse en tiempo lineal. Antes, «[a](»
// repetido tardaba ~0,24 s con 1500 caracteres y ~37 s con 8000, y el .ics de un feed con muchas tareas congelaba el servidor.
const ADVERSARIAL = ["[a](", "![a](", "[a](b ", "~~a", "`", "```\n", "> ", "- [ ] ", "<a ", "++a", "\\[", "[", "](", "](b"];

test("markdownToPlain es lineal con entradas adversarias", () => {
  for (const unit of ADVERSARIAL) {
    const input = unit.repeat(Math.ceil(20_000 / unit.length));
    const start = performance.now();
    markdownToPlain(input);
    const ms = performance.now() - start;
    assert.ok(ms < 500, `«${unit}» repetido tarda ${ms.toFixed(0)} ms`);
  }
});

test("markdownToPlain sigue convirtiendo enlaces normales", () => {
  assert.equal(markdownToPlain("Ver [la guía](https://example.com/guia) ya"), "Ver la guía (https://example.com/guia) ya");
  assert.equal(markdownToPlain('Ver [x](https://example.com "título")'), "Ver x (https://example.com)");
  assert.equal(markdownToPlain("[https://example.com](https://example.com)"), "https://example.com");
});
