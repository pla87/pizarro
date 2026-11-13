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

test("tablero grande: solo se repasan las tarjetas de la columna bajo el puntero", () => {
  // Cinco columnas de 60 tarjetas; cada tarjeta dice su lista (SortableContext con el id de su columna).
  const rects = new Map<string, ReturnType<typeof rect>>();
  const containers: unknown[] = [];
  const add = (id: string, r: ReturnType<typeof rect>, containerId?: string) => {
    rects.set(id, r);
    containers.push({ id, key: id, data: { current: containerId ? { sortable: { containerId, index: 0 } } : undefined }, disabled: false, node: { current: null }, rect: { current: r } });
  };
  for (let c = 0; c < 5; c++) {
    add(`col:${c}`, rect(c * 110, 0, 100, 6000));
    for (let i = 0; i < 60; i++) add(`t${c}-${i}`, rect(c * 110 + 5, i * 100, 90, 90), `col:${c}`);
  }
  // Una tarjeta de otra columna que se solapa con el puntero (p. ej. a medio animar) no cuenta.
  rects.set("t4-1", rect(225, 1000, 90, 90));
  const sizes: number[] = [];
  const spy: CollisionDetection = (args) => {
    sizes.push(args.droppableContainers.length);
    return pointerWithin(args);
  };
  const detect = createBoardCollisionDetection({ closestCorners, pointerWithin: spy });
  const args = {
    active: { id: "x", data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(225, 1000, 80, 40),
    droppableRects: rects,
    droppableContainers: containers,
    pointerCoordinates: { x: 260, y: 1020 },
  } as unknown as Args;
  assert.deepEqual(detect(args).map((c) => c.id), ["t2-10"]);
  // Antes se repasaban los 305 droppables en cada movimiento del ratón; ahora, 5 columnas y 60 tarjetas.
  assert.deepEqual(sizes, [5, 60]);
});

test("en el hueco entre dos tarjetas manda la más cercana (no la columna); por encima o por debajo, la columna", () => {
  const card = (id: string, r: ReturnType<typeof rect>) => ({ id, key: id, data: { current: { sortable: { containerId: "col:a", index: 0 } } }, disabled: false, node: { current: null }, rect: { current: r } });
  const base = scenario({ x: 50, y: 0 });
  base.droppableRects.set("t0", rect(5, 100, 90, 60));
  base.droppableRects.set("t1", rect(5, 170, 90, 60));
  base.droppableContainers.splice(0, base.droppableContainers.length, ...base.droppableContainers.filter((c) => c.id !== "t1"));
  base.droppableContainers.push(card("t0", rect(5, 100, 90, 60)) as never, card("t1", rect(5, 170, 90, 60)) as never);
  const at = (y: number) => boardCollisionDetection({ ...base, pointerCoordinates: { x: 50, y } })[0]?.id;
  assert.equal(at(163), "t0"); // hueco t0–t1, más cerca de t0
  assert.equal(at(168), "t1"); // hueco t0–t1, más cerca de t1
  assert.equal(at(120), "t0"); // sobre la tarjeta
  assert.equal(at(500), "col:a"); // bajo la última tarjeta
  assert.equal(at(50), "col:a"); // encima de la primera
});

test("cada medida se lee una vez por detección y solo las de la columna bajo el puntero", () => {
  // Como las de dnd-kit: top/left/bottom/right son getters que consultan el scroll en cada lectura.
  const reads = new Map<string, number>();
  const live = (id: string, r: ReturnType<typeof rect>) => {
    const out = { width: r.width, height: r.height } as Record<string, number>;
    for (const k of ["top", "left", "bottom", "right"] as const) {
      Object.defineProperty(out, k, { enumerable: true, get: () => (reads.set(id, (reads.get(id) ?? 0) + 1), r[k]) });
    }
    return out;
  };
  const base = scenario({ x: 50, y: 330 });
  const card = (id: string, column = "col:a") => ({ id, key: id, data: { current: { sortable: { containerId: column, index: 0 } } }, disabled: false, node: { current: null }, rect: { current: null } });
  for (let i = 0; i < 20; i++) base.droppableRects.set(`a${i}`, rect(5, 400 + i * 70, 90, 60));
  base.droppableContainers.push(...Array.from({ length: 20 }, (_, i) => card(`a${i}`) as never));
  base.droppableRects.set("c0", rect(225, 400, 90, 60));
  base.droppableContainers.push(card("c0", "col:c") as never);
  const droppableRects = new Map([...base.droppableRects].map(([id, r]) => [id, live(String(id), r as ReturnType<typeof rect>)]));
  const hit = boardCollisionDetection({ ...base, droppableRects } as unknown as Args);
  assert.equal(hit[0]?.id, "t1");
  // Dos lecturas (top y left) como mucho por medida; las tarjetas de otras columnas (c0) ni se leen.
  assert.ok(reads.size > 0);
  for (const [id, n] of reads) assert.ok(n <= 2, `${id}: ${n} lecturas`);
  assert.equal(reads.get("c0"), undefined);
});
