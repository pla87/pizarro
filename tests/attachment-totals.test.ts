// Contadores de adjuntos que calcula el cliente sobre la lista que muestra el diálogo (valor absoluto, sin sumas acumuladas).
import assert from "node:assert/strict";
import { test } from "node:test";

const { attachmentTotalsOf } = await import("../src/lib/attachment-totals");

test("attachmentTotalsOf cuenta imágenes, otros archivos y bytes de la lista, y una lista vacía deja todo a cero", () => {
  assert.deepEqual(attachmentTotalsOf([]), { imageCount: 0, fileCount: 0, attachBytes: 0 });
  const list = [
    { isImage: true, size: 1000 },
    { isImage: false, size: 5_000_000 },
    { isImage: false, size: 6_000_000 },
  ];
  assert.deepEqual(attachmentTotalsOf(list), { imageCount: 1, fileCount: 2, attachBytes: 11_001_000 });
  // «Añadir y quitar todos»: la lista vuelve a estar vacía y los contadores también, pase lo que pase en medio.
  assert.deepEqual(attachmentTotalsOf(list.slice(3)), { imageCount: 0, fileCount: 0, attachBytes: 0 });
});
