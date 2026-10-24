import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTaskOrder, insertBefore, moveOnto, needsRebalance, neighboursOf, positionBetween, POSITION_STEP } from "../src/lib/positions";

test("posiciones entre vecinos", () => {
  assert.equal(positionBetween(null, null), POSITION_STEP);
  assert.equal(positionBetween(1000, null), 1000 + POSITION_STEP);
  assert.equal(positionBetween(null, 1000), 1000 - POSITION_STEP);
  assert.equal(positionBetween(1000, 2000), 1500);
});

test("detecta cuándo hay que renumerar", () => {
  assert.equal(needsRebalance(1, 2), false);
  assert.equal(needsRebalance(1, 1 + 1e-9), true);
  assert.equal(needsRebalance(null, 1), false);
});

test("arrastrar con filtro: los vecinos son los de la lista completa", () => {
  // Columna completa A B C D E; con el filtro solo se ven A, C y E.
  const full = ["a", "b", "c", "d", "e"];
  // E sube sobre C (visible): queda justo antes de C, después de B oculta.
  const up = moveOnto(full, "e", "c");
  assert.deepEqual(up, ["a", "b", "e", "c", "d"]);
  assert.deepEqual(neighboursOf(up, "e"), { prevId: "b", nextId: "c" });
  // A baja sobre C: queda justo después de C, antes de D oculta; B y D mantienen su orden.
  const down = moveOnto(full, "a", "c");
  assert.deepEqual(down, ["b", "c", "a", "d", "e"]);
  assert.deepEqual(neighboursOf(down, "a"), { prevId: "c", nextId: "d" });
  // Mover a la primera y última posición.
  assert.deepEqual(neighboursOf(moveOnto(full, "c", "a"), "c"), { prevId: null, nextId: "a" });
  assert.deepEqual(neighboursOf(moveOnto(full, "c", "e"), "c"), { prevId: "e", nextId: null });
  assert.equal(moveOnto(full, "c", "c"), full);
});

test("arrastrar con filtro entre columnas", () => {
  const target = ["x", "y", "z"];
  assert.deepEqual(insertBefore(target, "t", "z"), ["x", "y", "t", "z"]);
  assert.deepEqual(insertBefore(target, "t", "x"), ["t", "x", "y", "z"]);
  // Columna vacía o contenedor: al final.
  assert.deepEqual(insertBefore([], "t", "col:1"), ["t"]);
  assert.deepEqual(insertBefore(target, "t", "col:1"), ["x", "y", "z", "t"]);
  // Sin duplicar si ya estaba.
  assert.deepEqual(insertBefore(["t", "x"], "t", "x"), ["t", "x"]);
  const pos = positionBetween(1024, 2048);
  assert.ok(pos > 1024 && pos < 2048);
});

test("sin hueco también con vecinas iguales, al revés o tan grandes que el punto medio no cabe", () => {
  assert.equal(needsRebalance(1000, 1000), true);
  assert.equal(needsRebalance(2000, 1000), true);
  assert.equal(needsRebalance(1e17, 1e17 + 16), true);
  assert.equal(needsRebalance(1000, 2000), false);
});

test("orden de tarjetas: posición y, si coinciden, id (como el servidor)", () => {
  const list = [{ id: "b", position: 1 }, { id: "a", position: 1 }, { id: "c", position: 0.5 }];
  assert.deepEqual([...list].sort(compareTaskOrder).map((t) => t.id), ["c", "a", "b"]);
  assert.deepEqual([...list].reverse().sort(compareTaskOrder).map((t) => t.id), ["c", "a", "b"]);
});
