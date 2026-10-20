import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeMarkdown } from "../src/lib/markdown-paste";
import { underlineToLink } from "../src/lib/markdown-underline";

test("++x++ pasa a enlace #u", () => {
  assert.equal(underlineToLink("hola ++mundo++ y ++**negrita**++"), "hola [mundo](#u) y [**negrita**](#u)");
});

test("no toca código ni c++", () => {
  assert.equal(underlineToLink("`++a++` y c++ y d++"), "`++a++` y c++ y d++");
  assert.equal(underlineToLink("```\n++a++\n```\n++b++"), "```\n++a++\n```\n[b](#u)");
  assert.equal(underlineToLink("a ++ b ++ c"), "a ++ b ++ c");
});

test("detecta Markdown pegado", () => {
  for (const s of ["**x**", "- item", "1. item", "# T", "~~x~~", "++x++", "[a](http://b.c)"]) assert.ok(looksLikeMarkdown(s), s);
  for (const s of ["hola mundo", "2 * 3 = 6", "Precio: 5 - 3"]) assert.ok(!looksLikeMarkdown(s), s);
});
