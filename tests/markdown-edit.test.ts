import assert from "node:assert/strict";
import { test } from "node:test";
import { indentDelta, indentLines, insertLink, insertRule, listMarker, toggleCodeBlock, toggleLinePrefix, toggleWrap } from "../src/lib/markdown-edit";

test("listMarker: viñetas, numeradas y casillas", () => {
  assert.deepEqual(listMarker("- a"), { indent: 0, width: 2 });
  assert.deepEqual(listMarker("  - [ ] a"), { indent: 2, width: 2 });
  assert.deepEqual(listMarker("1. a"), { indent: 0, width: 3 });
  assert.equal(listMarker("texto"), null);
  assert.equal(listMarker("-a"), null);
});

test("sangría: una línea se anida bajo su hermano anterior", () => {
  const v = "- a\n- b";
  const r = indentLines(v, 5, 5, 1)!;
  assert.equal(r.value, "- a\n  - b");
  assert.equal(r.start, 7);
});

test("sangría: la primera línea de la lista no se puede sangrar (Tab sigue su camino)", () => {
  assert.equal(indentLines("- a\n- b", 0, 0, 1), null);
  // Ya es hijo directo del anterior: no se anida más.
  assert.equal(indentLines("- a\n  - b", 6, 6, 1), null);
  // Fuera de una lista no hace nada.
  assert.equal(indentLines("texto\nmás", 0, 8, 1), null);
});

test("sangría: las numeradas se anidan con el ancho de su marcador (3)", () => {
  assert.equal(indentLines("1. a\n2. b", 6, 6, 1)!.value, "1. a\n   2. b");
  assert.equal(indentLines("1. a\n   2. b", 8, 8, -1)!.value, "1. a\n2. b");
});

test("sangría: reducir devuelve al nivel del padre y no pasa de cero", () => {
  assert.equal(indentLines("- a\n  - b", 6, 6, -1)!.value, "- a\n- b");
  assert.equal(indentLines("- a\n- b", 5, 5, -1), null);
  assert.equal(indentDelta("- a\n  - b\n    - c", 2, -1), -2);
});

test("sangría: varias líneas se mueven juntas conservando su estructura", () => {
  const v = "- a\n- b\n  - c\n- d";
  const r = indentLines(v, 4, 17, 1)!;
  assert.equal(r.value, "- a\n  - b\n    - c\n  - d");
  assert.equal(indentLines(r.value, r.start, r.end, -1)!.value, v);
});

test("sangría: en una selección, la primera línea de la lista se salta y las de debajo se anidan", () => {
  assert.equal(indentLines("- a\n- b\n- c", 0, 11, 1)!.value, "- a\n  - b\n  - c");
});

test("sangría: las casillas también se anidan", () => {
  assert.equal(indentLines("- [ ] a\n- [x] b", 9, 9, 1)!.value, "- [ ] a\n  - [x] b");
});

test("toggleWrap: envuelve, desenvuelve y deja el cursor dentro sin selección", () => {
  assert.deepEqual(toggleWrap("hola mundo", 5, 10, "**"), { value: "hola **mundo**", start: 7, end: 12 });
  assert.equal(toggleWrap("hola **mundo**", 7, 12, "**").value, "hola mundo");
  const empty = toggleWrap("", 0, 0, "`", "`", "código");
  assert.equal(empty.value, "`código`");
  assert.equal(empty.value.slice(empty.start, empty.end), "código");
});

test("toggleLinePrefix: lista, numerada, casillas, cita y títulos; se quitan al repetir", () => {
  assert.equal(toggleLinePrefix("a\nb", 0, 3, "ul").value, "- a\n- b");
  assert.equal(toggleLinePrefix("- a\n- b", 0, 7, "ul").value, "a\nb");
  assert.equal(toggleLinePrefix("a\nb", 0, 3, "ol").value, "1. a\n2. b");
  assert.equal(toggleLinePrefix("a\nb", 0, 3, "task").value, "- [ ] a\n- [ ] b");
  assert.equal(toggleLinePrefix("- a", 0, 3, "task").value, "- [ ] a");
  assert.equal(toggleLinePrefix("a", 0, 1, "quote").value, "> a");
  assert.equal(toggleLinePrefix("## a", 0, 4, "h2").value, "a");
  assert.equal(toggleLinePrefix("## a", 0, 4, "h3").value, "### a");
  // Conserva la sangría y salta las líneas vacías de una selección.
  assert.equal(toggleLinePrefix("  a\n\n  b", 0, 8, "ul").value, "  - a\n\n  - b");
  // Una línea vacía sola recibe el prefijo y el cursor queda tras él.
  const r = toggleLinePrefix("", 0, 0, "ul");
  assert.deepEqual(r, { value: "- ", start: 2, end: 2 });
});

test("toggleCodeBlock: pone y quita las vallas", () => {
  const on = toggleCodeBlock("a\nb", 0, 3);
  assert.equal(on.value, "```\na\nb\n```");
  assert.equal(toggleCodeBlock(on.value, on.start, on.end).value, "a\nb");
});

test("insertRule e insertLink", () => {
  assert.equal(insertRule("hola", 4, 4).value, "hola\n\n---\n\n");
  assert.equal(insertRule("", 0, 0).value, "---\n\n");
  const link = insertLink("ver docs", 4, 8);
  assert.equal(link.value, "ver [docs](https://)");
  assert.equal(link.value.slice(link.start, link.end), "https://");
  const url = insertLink("https://example.com", 0, 19);
  assert.equal(url.value, "[texto](https://example.com)");
});
