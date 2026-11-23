// Botón «Ver lista» (Lista de comprobación): el motivo por el que no se puede usar y la suscripción al almacén de tareas,
// que solo debe redibujar el botón cuando cambia el motivo de SU columna.
import assert from "node:assert/strict";
import { test } from "node:test";
import { columnGate, columnGateSnapshot, type ColumnGate } from "../src/components/board/columnGate";
import type { BoardTask } from "../src/lib/types";

/**
 * El almacén del tablero (createStore, src/components/board/stores.ts), copiado: aquel módulo importa hooks de React, que
 * no existen con la condición `react-server` con la que corren estas pruebas.
 */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: (prev: T) => T) => {
      const v = next(value);
      if (Object.is(v, value)) return;
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

let n = 0;
const task = (columnId: string, over: Partial<BoardTask> = {}): BoardTask => ({ id: `t${++n}`, columnId, title: "T", dueDate: null, subtaskTotal: 0, ...over }) as BoardTask;

test("motivo: sin tarjetas, sin subtareas (Lista) o ninguno", () => {
  const tasks = [task("lista"), task("otra", { dueDate: "2026-12-01", subtaskTotal: 3 })];
  assert.equal(columnGate(tasks, "lista", "CHECKLIST", 0), "empty");
  assert.equal(columnGate(tasks, "lista", "CHECKLIST", 1), "noSubtasks");
  // Lo de otra columna no cuenta.
  assert.equal(columnGate(tasks, "otra", "CHECKLIST", 1), null);
  assert.equal(columnGate([...tasks, task("lista", { subtaskTotal: 1 })], "lista", "CHECKLIST", 2), null);
  // Una fecha en la Lista no sirve.
  assert.equal(columnGate([task("lista", { dueDate: "2026-12-02" })], "lista", "CHECKLIST", 1), "noSubtasks");
  // Un rol sin condición propia (también uno retirado, como la Agenda) solo mira que haya tarjetas.
  assert.equal(columnGate(tasks, "lista", "NONE", 1), null);
  assert.equal(columnGate(tasks, "lista", "AGENDA", 1), null);
});

/**
 * Un suscriptor como useSyncExternalStore: tras cada aviso del almacén pide la instantánea y solo «redibuja» si ha
 * cambiado (Object.is), que es exactamente lo que hace React. `renders` cuenta esos dibujos (el primero incluido).
 */
function subscriber<T>(subscribe: (l: () => void) => () => void, getSnapshot: () => T) {
  const state = { renders: 1, value: getSnapshot(), checks: 0 };
  const stop = subscribe(() => {
    state.checks++;
    const next = getSnapshot();
    if (Object.is(next, state.value)) return;
    state.value = next;
    state.renders++;
  });
  return { state, stop };
}

test("suscripción: el botón no se redibuja al cambiar tareas de otra columna (ni de la suya si el motivo sigue igual)", () => {
  const big = Array.from({ length: 2000 }, (_, i) => task(`c${i % 8}`, { dueDate: i % 3 ? "2026-12-01" : null, subtaskTotal: i % 5 }));
  const l1 = task("lista");
  const l2 = task("lista");
  const store = createStore<BoardTask[]>([...big, l1, l2]);
  const edit = (id: string, over: Partial<BoardTask>) => store.set((prev) => prev.map((x) => (x.id === id ? { ...x, ...over } : x)));

  const lista = subscriber<ColumnGate | null>(store.subscribe, columnGateSnapshot(store, "lista", "CHECKLIST", 2));
  // Lo que hacía antes (useTasks): la instantánea es la lista entera, que cambia con cualquier tarea.
  const before = subscriber(store.subscribe, store.get);
  assert.equal(lista.state.value, "noSubtasks");

  // 200 cambios en tareas de otras columnas (títulos, fechas, subtareas, moverlas entre ellas).
  for (let i = 0; i < 200; i++) edit(big[i * 7]!.id, { title: `T${i}`, dueDate: "2026-12-24", subtaskTotal: i, columnId: `c${(i + 1) % 8}` });
  assert.equal(lista.state.checks, 200, "el almacén avisó las 200 veces");
  assert.equal(lista.state.renders, 1, "Lista: ningún dibujo nuevo");
  assert.equal(before.state.renders, 201, "con la lista entera se redibujaba en cada cambio");

  // Cambios en su propia columna que no cambian el motivo: tampoco.
  edit(l1.id, { title: "Otro", dueDate: "2026-12-05" });
  assert.equal(lista.state.renders, 1);

  // Cambia el motivo (una tarjeta ya tiene subtareas): se redibuja, una vez.
  edit(l1.id, { subtaskTotal: 2 });
  assert.equal(lista.state.value, null);
  assert.equal(lista.state.renders, 2);
  // Otra con subtareas: el motivo sigue siendo «ninguno».
  edit(l2.id, { subtaskTotal: 1 });
  assert.equal(lista.state.renders, 2);
  // Se quitan las dos: vuelve el motivo.
  edit(l1.id, { subtaskTotal: 0 });
  assert.equal(lista.state.renders, 2);
  edit(l2.id, { subtaskTotal: 0 });
  assert.equal(lista.state.value, "noSubtasks");
  assert.equal(lista.state.renders, 3);
  // Una tarjeta con subtareas llega de otra columna.
  edit(big[1]!.id, { columnId: "lista", subtaskTotal: 3 });
  assert.equal(lista.state.value, null);

  lista.stop();
  before.stop();
});

test("instantánea: una sola pasada por lista de tareas y columna, y «sin tarjetas» sin mirar la lista", () => {
  let reads = 0;
  const list = Array.from({ length: 50 }, () => task("lista"));
  const counted = list.map((x) => Object.defineProperty({ ...x }, "subtaskTotal", { get: () => (reads++, 0), enumerable: true }));
  const store = createStore<BoardTask[]>(counted);
  const snap = columnGateSnapshot(store, "lista", "CHECKLIST", 50);
  assert.equal(snap(), "noSubtasks");
  assert.equal(reads, 50);
  // El botón de la cabecera y el del menú piden lo mismo, y React la pide en cada dibujo: no se vuelve a recorrer.
  for (let i = 0; i < 20; i++) assert.equal(columnGateSnapshot(store, "lista", "CHECKLIST", 50)(), "noSubtasks");
  assert.equal(reads, 50);
  // Otra columna u otro rol sobre la misma lista: su propia pasada, sin mezclar resultados.
  assert.equal(columnGateSnapshot(store, "lista", "NONE", 50)(), null);
  assert.equal(columnGateSnapshot(store, "otra", "CHECKLIST", 3)(), "noSubtasks");
  assert.equal(snap(), "noSubtasks");
  // Sin tarjetas a la vista no hace falta la lista.
  const empty = columnGateSnapshot({ get: () => assert.fail("no debe leer el almacén") }, "lista", "CHECKLIST", 0);
  assert.equal(empty(), "empty");
});
