// Arrastrar (o mover con Alt+flechas) una tarjeta de una selección múltiple mueve toda la selección: reglas puras del
// cliente (groupDrag.ts), posiciones del bloque (positions.ts) y avisos del lector de pantalla (drag-a11y.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Announcements } from "@dnd-kit/core";
import { keyboardBlock, placeBlock, sameOrder, selectionGroup } from "../src/components/board/groupDrag";
import { boardDragA11y } from "../src/components/board/drag-a11y";
import { blockNeedsRebalance, spreadPositions, POSITION_STEP } from "../src/lib/positions";
import { esT, makeTWith } from "../src/i18n/shared";
import { EN } from "../src/i18n/en";

const COLS = ["todo", "doing", "done"];
const items = { todo: ["a", "b", "c", "d"], doing: ["e", "f"], done: [] as string[] };

describe("selectionGroup", () => {
  test("la selección en orden de tablero si la cogida está en ella y hay dos o más", () => {
    assert.deepEqual(selectionGroup(new Set(["f", "c", "a"]), "c", COLS, items), ["a", "c", "f"]);
  });
  test("una sin seleccionar, o una selección de una, se mueve sola", () => {
    assert.equal(selectionGroup(new Set(["a", "c"]), "b", COLS, items), null);
    assert.equal(selectionGroup(new Set(["a"]), "a", COLS, items), null);
  });
  test("las seleccionadas que no están en las listas (fijas, ya no existen) no cuentan", () => {
    assert.equal(selectionGroup(new Set(["a", "x"]), "a", COLS, items), null);
    assert.deepEqual(selectionGroup(new Set(["a", "x", "e"]), "e", COLS, items), ["a", "e"]);
  });
});

describe("placeBlock", () => {
  test("a otra columna: todas seguidas en el hueco de la cogida, en el orden del grupo", () => {
    // Se arrastra «c» (con «a» y «f») entre «e» y el final de «doing»; «f» sigue donde estaba (atenuada).
    const r = placeBlock(["e", "c", "f"], "c", ["a", "c", "f"]);
    assert.deepEqual(r, { list: ["e", "a", "c", "f"], prevId: "e", nextId: null });
  });
  test("dentro de la misma columna, el resto no cambia de orden", () => {
    // [A*, B, C*, D] y A soltada entre C y D: queda tras B (el hueco entre las no seleccionadas).
    assert.deepEqual(placeBlock(["b", "c", "a", "d"], "a", ["a", "c"]), { list: ["b", "a", "c", "d"], prevId: "b", nextId: "d" });
    assert.deepEqual(placeBlock(["a", "b", "c", "d"], "a", ["a", "c"]), { list: ["a", "c", "b", "d"], prevId: null, nextId: "b" });
  });
  test("columna vacía", () => {
    assert.deepEqual(placeBlock(["b"], "b", ["b", "e"]), { list: ["b", "e"], prevId: null, nextId: null });
  });
  test("soltar el bloque donde ya estaba no cambia nada", () => {
    const r = placeBlock(["a", "b", "c"], "b", ["a", "b"]);
    assert.ok(sameOrder(r.list, ["a", "b", "c"]));
    assert.ok(!sameOrder(["a", "b"], ["b", "a"]));
  });
});

describe("keyboardBlock", () => {
  test("Alt+→: todo el grupo al final de la columna siguiente a la de la que tiene el foco", () => {
    assert.deepEqual(keyboardBlock(items, COLS, ["a", "c", "f"], "c", "right"), { columnId: "doing", list: ["e", "a", "c", "f"], prevId: "e", nextId: null });
    assert.deepEqual(keyboardBlock(items, COLS, ["a", "e"], "e", "right"), { columnId: "done", list: ["a", "e"], prevId: null, nextId: null });
    assert.equal(keyboardBlock(items, COLS, ["a", "c"], "a", "left"), null);
  });
  test("Alt+↑/↓: el bloque, junto, un puesto arriba o abajo", () => {
    const col = { todo: ["x", "a", "b", "y", "z"] };
    assert.deepEqual(keyboardBlock(col, ["todo"], ["a", "b"], "a", "up")?.list, ["a", "b", "x", "y", "z"]);
    assert.deepEqual(keyboardBlock(col, ["todo"], ["a", "b"], "b", "down")?.list, ["x", "y", "a", "b", "z"]);
    // Arriba del todo: no cambia (el tablero no hace nada).
    assert.deepEqual(keyboardBlock({ todo: ["a", "b", "x"] }, ["todo"], ["a", "b"], "a", "up")?.list, ["a", "b", "x"]);
    // Separadas: se juntan al subir.
    assert.deepEqual(keyboardBlock({ todo: ["x", "a", "y", "b"] }, ["todo"], ["a", "b"], "b", "up")?.list, ["a", "b", "x", "y"]);
  });
});

describe("posiciones del bloque", () => {
  test("repartidas en el hueco, o de paso en paso al final o al principio", () => {
    assert.deepEqual(spreadPositions(1000, 2000, 3), [1250, 1500, 1750]);
    assert.deepEqual(spreadPositions(1000, null, 2), [1000 + POSITION_STEP, 1000 + 2 * POSITION_STEP]);
    assert.deepEqual(spreadPositions(null, 3000, 2), [3000 - 2 * POSITION_STEP, 3000 - POSITION_STEP]);
    assert.deepEqual(spreadPositions(null, null, 2), [POSITION_STEP, 2 * POSITION_STEP]);
  });
  test("sin sitio para todas hay que renumerar", () => {
    assert.equal(blockNeedsRebalance(1000, 2000, 500), false);
    assert.equal(blockNeedsRebalance(1000, 1000 + 1e-6, 3), true);
    assert.equal(blockNeedsRebalance(2000, 1000, 1), true);
    assert.equal(blockNeedsRebalance(null, 1000, 50), false);
  });
});

describe("avisos del lector de pantalla", () => {
  const where = (id: string) => (id.startsWith("ever:") ? { evergreen: "Release" } : { column: id === "col:2" || id === "c" ? "Hecho" : "Por hacer" });
  const announce = (count: number, t = esT) => boardDragA11y(t, () => "Uno", where, () => count).announcements as Required<Announcements>;
  const active = { id: "a" } as never;
  test("con una selección dicen cuántas son", () => {
    const a = announce(3);
    assert.equal(a.onDragStart({ active } as never), "Has cogido 3 tarjetas («Uno» y 2 más), en la columna Por hacer.");
    assert.equal(a.onDragOver({ active, over: { id: "col:2" } } as never), "Las 3 tarjetas están sobre la columna Hecho.");
    assert.equal(a.onDragEnd({ active, over: { id: "c" } } as never), "Has soltado 3 tarjetas en la columna Hecho.");
    // Sobre el panel de fijas una selección va a la columna (como tareas normales).
    assert.equal(a.onDragEnd({ active, over: { id: "ever:x" } } as never), "Has soltado 3 tarjetas en la columna Release.");
    assert.equal(a.onDragCancel({ active } as never), "Arrastre cancelado: las 3 tarjetas vuelven a su sitio.");
  });
  test("con una sola, como siempre", () => {
    const a = announce(1);
    assert.equal(a.onDragStart({ active } as never), "Has cogido «Uno», en la columna Por hacer.");
    assert.equal(a.onDragEnd({ active, over: null } as never), "Has soltado «Uno» fuera de las columnas: no se mueve.");
  });
  test("en inglés", () => {
    const a = announce(2, makeTWith(EN));
    assert.equal(a.onDragStart({ active } as never), "Picked up 2 cards (“Uno” and 1 more), in the Por hacer column.");
  });
});
