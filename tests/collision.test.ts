import assert from "node:assert/strict";
import { test } from "node:test";
import type { CollisionDetection } from "@dnd-kit/core";
import { createBoardCollisionDetection } from "../src/lib/collision";

// Versiones mínimas de los algoritmos de dnd-kit (el paquete real necesita React).
const inside = (r: { left: number; right: number; top: number; bottom: number }, p: { x: number; y: number }) =>
  p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
const pointerWithin: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates }) =>
  droppableContainers
    .filter((c) => pointerCoordinates && inside(droppableRects.get(c.id)!, pointerCoordinates))
    .map((c) => ({ id: c.id }));
const closestCorners: CollisionDetection = ({ droppableContainers, droppableRects, collisionRect }) =>
  droppableContainers
    .map((c) => {
      const r = droppableRects.get(c.id)!;
      const d = Math.hypot(r.left - collisionRect.left, r.top - collisionRect.top) + Math.hypot(r.right - collisionRect.right, r.bottom - collisionRect.bottom);
      return { id: c.id, d };
    })
    .sort((a, b) => a.d - b.d)
    .map(({ id }) => ({ id }));
const boardCollisionDetection = createBoardCollisionDetection({ closestCorners, pointerWithin });

type Args = Parameters<CollisionDetection>[0];
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

/** Tres columnas de 100 de ancho: la del medio, vacía y corta; las vecinas, altas y con tarjetas. */
function scenario(pointer: { x: number; y: number } | null, dragged = rect(110, 300, 80, 40)): Args {
  const rects: Record<string, ReturnType<typeof rect>> = {
    "col:a": rect(0, 0, 100, 600),
    "col:b": rect(110, 0, 100, 600),
    "col:c": rect(220, 0, 100, 600),
    t1: rect(5, 300, 90, 60),
    t2: rect(225, 300, 90, 60),
  };
  const droppableRects = new Map(Object.entries(rects));
  return {
    active: { id: "x", data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    collisionRect: dragged,
    droppableRects,
    droppableContainers: Object.keys(rects).map((id) => ({ id, key: id, data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: rects[id]! } })),
    pointerCoordinates: pointer,
  } as unknown as Args;
}

test("columna vacía bajo el puntero gana aunque la tarjeta arrastrada solape con la vecina", () => {
  // La tarjeta arrastrada sobresale hacia la columna de la izquierda, pero el puntero está en la vacía.
  const args = scenario({ x: 150, y: 320 }, rect(60, 300, 80, 40));
  assert.equal(boardCollisionDetection(args)[0]?.id, "col:b");
});

test("sobre una tarjeta manda la tarjeta, no su columna", () => {
  assert.equal(boardCollisionDetection(scenario({ x: 50, y: 320 }))[0]?.id, "t1");
});

test("sin puntero (teclado) se usan las esquinas más cercanas", () => {
  assert.equal(boardCollisionDetection(scenario(null, rect(112, 10, 80, 40)))[0]?.id, "col:b");
});

test("las columnas ocultas (ancho 0) se ignoran", () => {
  const args = scenario({ x: 150, y: 320 });
  args.droppableRects.set("col:b", rect(0, 0, 0, 0));
  assert.notEqual(boardCollisionDetection(args)[0]?.id, "col:b");
});
