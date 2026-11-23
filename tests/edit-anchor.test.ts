import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorIndex } from "../src/lib/edit-anchor";
import { suggestionsPlacement } from "../src/lib/popup-place";

// Doble clic en la descripción del detalle: el punto de la vista de lectura se busca en el texto del editor.
test("anchorIndex: el contexto de los dos lados, la aparición más cercana a la proporción", () => {
  const text = "uno dos tres\n\nuno dos tres";
  // «dos| tres» aparece dos veces: con la proporción del final, la segunda.
  assert.equal(anchorIndex(text, { before: "uno dos", after: " tres", ratio: 0.9 }), text.lastIndexOf("dos") + 3);
  assert.equal(anchorIndex(text, { before: "uno dos", after: " tres", ratio: 0.1 }), text.indexOf("dos") + 3);
});

test("anchorIndex: con las marcas de Markdown en medio se busca con trozos más cortos", () => {
  // En la vista de lectura se ve «Hola mundo bonito» (sin los **); el textarea del modo Markdown tiene las marcas.
  const md = "Hola **mundo** bonito y algo más";
  const at = anchorIndex(md, { before: "Hola mundo bo", after: "nito y algo más", ratio: 0.4 });
  assert.equal(md.slice(at, at + 4), "nito");
  // Entre dos párrafos el texto visible va seguido («rato.Párrafo»); en el Markdown hay una línea en blanco.
  const two = "Primero rato.\n\nPárrafo segundo";
  const at2 = anchorIndex(two, { before: "Primero rato.", after: "Párrafo segundo", ratio: 0.5 });
  assert.ok(two.slice(at2).startsWith("Párrafo") || two.slice(0, at2).endsWith("rato."), String(at2));
});

test("anchorIndex: sin nada que coincida, la proporción", () => {
  assert.equal(anchorIndex("abcdefghij", { before: "zzz", after: "yyy", ratio: 0.5 }), 5);
  assert.equal(anchorIndex("", { before: "a", after: "b", ratio: 0.7 }), 0);
});

// Sugerencias de «@»: debajo del cursor si caben; si no, encima, sin salirse de lo visible.
test("suggestionsPlacement: debajo si cabe, encima si no", () => {
  const view = { top: 0, bottom: 800, width: 1200, height: 800 };
  const below = suggestionsPlacement({ top: 100, bottom: 120, left: 50 }, view, 200, 288);
  assert.deepEqual(below, { top: 124, left: 50, maxHeight: 256 });
  // Al pie del diálogo (comentario): no cabe debajo y se abre hacia arriba, anclada por abajo.
  const above = suggestionsPlacement({ top: 740, bottom: 760, left: 50 }, view, 200, 288);
  assert.equal(above.top, undefined);
  assert.equal(above.bottom, 800 - 740 + 4);
  assert.equal(above.maxHeight, 256);
  // Pegada al borde derecho: se mete dentro.
  assert.equal(suggestionsPlacement({ top: 100, bottom: 120, left: 1100 }, view, 100, 288).left, 1200 - 288 - 8);
  // Poco sitio por los dos lados (teclado del móvil): el lado con más sitio, con el alto recortado.
  const small = { top: 0, bottom: 300, width: 390, height: 844 };
  const p = suggestionsPlacement({ top: 200, bottom: 220, left: 10 }, small, 250, 288);
  assert.equal(p.bottom, 844 - 200 + 4);
  assert.equal(p.maxHeight, 200 - 4 - 8);
});

test("suggestionsPlacement: lista corta, lado con más sitio, margen izquierdo y parte visible desplazada", () => {
  const view = { top: 0, bottom: 800, width: 1200, height: 800 };
  // Una lista corta (dos opciones) cabe debajo aunque encima haya más sitio: va debajo.
  assert.deepEqual(suggestionsPlacement({ top: 600, bottom: 620, left: 50 }, view, 72, 288), { top: 624, left: 50, maxHeight: 800 - 620 - 4 - 8 });
  // No cabe por ningún lado y debajo hay más sitio: debajo, con el alto recortado.
  const small = { top: 0, bottom: 300, width: 390, height: 844 };
  assert.deepEqual(suggestionsPlacement({ top: 80, bottom: 100, left: 10 }, small, 250, 288), { top: 104, left: 10, maxHeight: 300 - 100 - 4 - 8 });
  // Con el mismo sitio por los dos lados, debajo.
  assert.equal(suggestionsPlacement({ top: 140, bottom: 160, left: 10 }, { top: 0, bottom: 300, width: 390, height: 300 }, 250, 288).top, 164);
  // Cursor pegado al borde izquierdo (o la lista más ancha que la ventana): nunca a menos de 8 px del borde.
  assert.equal(suggestionsPlacement({ top: 100, bottom: 120, left: 2 }, view, 100, 288).left, 8);
  assert.equal(suggestionsPlacement({ top: 100, bottom: 120, left: 50 }, { ...view, width: 280 }, 100, 288).left, 8);
  // Parte visible desplazada (móvil con zoom o el teclado abierto y la página subida): el sitio de encima se cuenta desde
  // su borde de arriba, no desde el de la ventana.
  const shifted = { top: 400, bottom: 700, width: 390, height: 844 };
  const up = suggestionsPlacement({ top: 650, bottom: 670, left: 10 }, shifted, 250, 288);
  assert.equal(up.bottom, 844 - 650 + 4);
  assert.equal(up.maxHeight, 650 - 400 - 4 - 8);
});
