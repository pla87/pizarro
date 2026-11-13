// Enlaces a adjuntos en un texto Markdown: Duplicar e importar un proyecto los apuntan a los adjuntos nuevos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { remapAttachmentRefs } from "../src/lib/attachment-refs";

test("cambia los ids que están en el mapa y deja los demás", () => {
  const map = new Map([["c1a", "c9z"], ["abc", "def"]]);
  assert.equal(
    remapAttachmentRefs("![x](/api/attachments/c1a) [d](/api/attachments/c1a?download=1) ![y](/api/attachments/otro) ![z](/api/attachments/abc)", map),
    "![x](/api/attachments/c9z) [d](/api/attachments/c9z?download=1) ![y](/api/attachments/otro) ![z](/api/attachments/def)",
  );
});

test("un id no se confunde con otro que empieza igual", () => {
  assert.equal(remapAttachmentRefs("![x](/api/attachments/c1ab)", new Map([["c1a", "c9z"]])), "![x](/api/attachments/c1ab)");
});

test("sin mapa o sin enlaces devuelve el mismo texto", () => {
  assert.equal(remapAttachmentRefs("hola", new Map([["a", "b"]])), "hola");
  assert.equal(remapAttachmentRefs("![x](/api/attachments/a)", new Map()), "![x](/api/attachments/a)");
});
