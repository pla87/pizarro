// Archivos de un pegado: una sola lectura, sin duplicados entre `files` e `items`, y sin la «foto» del texto de Office.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeFiles, htmlHasText, isEmptyImage, isTextSnapshot, pickClipboardFiles, type ClipboardItemLike } from "../src/lib/clipboard-files";

const png = (bytes: number, name = "image.png") => new File([new Uint8Array(bytes)], name, { type: "image/png" });
/** Item de portapapeles que cuenta sus lecturas (en Chrome cada getAsFile() vuelve a leer el portapapeles). */
function item(file: File | null, kind = "file") {
  const it = { kind, type: file?.type ?? "text/plain", reads: 0, getAsFile: () => (it.reads++, file) };
  return it satisfies ClipboardItemLike & { reads: number };
}

test("captura: `files` e `items` traen la misma imagen (dos File distintos en Chrome) → una sola, sin leer `items`", () => {
  const it = item(png(88));
  const files = pickClipboardFiles([png(88)], [it]);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.size, 88);
  assert.equal(it.reads, 0, "con `files` completo no se vuelve a leer el portapapeles");
});

test("Safari: sin `files`, se toman de `items` (solo los de tipo archivo)", () => {
  const files = pickClipboardFiles([], [item(null, "string"), item(png(10))]);
  assert.deepEqual(files.map((f) => f.size), [10]);
});

test("imagen vacía en `files` y con contenido en `items`: queda la que tiene contenido; vacía en los dos: una sola vacía", () => {
  assert.deepEqual(pickClipboardFiles([png(0)], [item(png(50))]).map((f) => f.size), [50]);
  assert.deepEqual(pickClipboardFiles([png(0)], [item(png(0))]).map((f) => f.size), [0]);
});

test("dedupeFiles: mismo nombre, tipo y tamaño cuentan una vez; archivos distintos se conservan", () => {
  const a = new File(["abc"], "a.txt", { type: "text/plain" });
  const a2 = new File(["xyz"], "a.txt", { type: "text/plain" });
  const b = new File(["abcd"], "a.txt", { type: "text/plain" });
  assert.deepEqual(dedupeFiles([a, a2, b]).length, 2);
  assert.deepEqual(dedupeFiles([png(0), png(5)]).map((f) => f.size), [5]);
});

test("texto copiado de Word/Excel con su imagen: en una caja de texto se pega el texto, no la foto", () => {
  const html = "<html><body><!--StartFragment--><table><tr><td>a</td></tr></table><!--EndFragment--></body></html>";
  assert.equal(isTextSnapshot(png(500), "a\tb", html), true);
  // Captura o «Copiar imagen» (HTML con solo <img>, sin texto): se adjunta.
  assert.equal(isTextSnapshot(png(500), "", '<img src="https://example.com/a.png">'), false);
  assert.equal(isTextSnapshot(png(500), "https://example.com/a.png", '<meta charset="utf-8"><img src="https://example.com/a.png">'), false);
  // Un archivo de verdad (copiado en el explorador) con su nombre como texto: se adjunta.
  assert.equal(isTextSnapshot(png(500, "plano.png"), "plano.png", "<p>plano.png</p>"), false);
});

test("htmlHasText e isEmptyImage", () => {
  assert.equal(htmlHasText("<style>p{}</style><img src=x><!-- c --> &nbsp; "), false);
  assert.equal(htmlHasText("<p>hola</p>"), true);
  assert.equal(isEmptyImage(png(0)), true);
  assert.equal(isEmptyImage(png(1)), false);
  assert.equal(isEmptyImage(new File([], "vacio.txt", { type: "text/plain" })), false);
});
