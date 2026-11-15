// Botones «Ver lista» (Lista de comprobación) y «Exportar a calendario» (Agenda): el motivo por el que no se pueden usar y
// la suscripción al almacén de tareas, que solo debe redibujar el botón cuando cambia el motivo de SU columna.
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

test("motivo: sin tarjetas, sin fecha límite (Agenda), sin subtareas (Lista) o ninguno", () => {
  const tasks = [task("agenda"), task("lista"), task("otra", { dueDate: "2026-12-01", subtaskTotal: 3 })];
  assert.equal(columnGate(tasks, "agenda", "AGENDA", 0), "empty");
  assert.equal(columnGate(tasks, "agenda", "AGENDA", 1), "noDueDate");
  assert.equal(columnGate(tasks, "lista", "CHECKLIST", 1), "noSubtasks");
  // Lo de otra columna no cuenta.
  assert.equal(columnGate(tasks, "otra", "AGENDA", 1), null);
  assert.equal(columnGate(tasks, "otra", "CHECKLIST", 1), null);
  assert.equal(columnGate([...tasks, task("agenda", { dueDate: "2026-12-02" })], "agenda", "AGENDA", 2), null);
  assert.equal(columnGate([...tasks, task("lista", { subtaskTotal: 1 })], "lista", "CHECKLIST", 2), null);
  // Una fecha en la Lista o subtareas en la Agenda no sirven.
  assert.equal(columnGate([task("lista", { dueDate: "2026-12-02" })], "lista", "CHECKLIST", 1), "noSubtasks");
  assert.equal(columnGate([task("agenda", { subtaskTotal: 2 })], "agenda", "AGENDA", 1), "noDueDate");
  // Un rol sin condición propia solo mira que haya tarjetas.
  assert.equal(columnGate(tasks, "agenda", "NONE", 1), null);
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
  const a1 = task("agenda");
  const a2 = task("agenda");
  const l1 = task("lista");
  const store = createStore<BoardTask[]>([...big, a1, a2, l1]);
  const edit = (id: string, over: Partial<BoardTask>) => store.set((prev) => prev.map((x) => (x.id === id ? { ...x, ...over } : x)));

  const agenda = subscriber<ColumnGate | null>(store.subscribe, columnGateSnapshot(store, "agenda", "AGENDA", 2));
  const lista = subscriber<ColumnGate | null>(store.subscribe, columnGateSnapshot(store, "lista", "CHECKLIST", 1));
  // Lo que hacía antes (useTasks): la instantánea es la lista entera, que cambia con cualquier tarea.
  const before = subscriber(store.subscribe, store.get);
  assert.equal(agenda.state.value, "noDueDate");
  assert.equal(lista.state.value, "noSubtasks");

  // 200 cambios en tareas de otras columnas (títulos, fechas, subtareas, moverlas entre ellas).
  for (let i = 0; i < 200; i++) edit(big[i * 7]!.id, { title: `T${i}`, dueDate: "2026-12-24", subtaskTotal: i, columnId: `c${(i + 1) % 8}` });
  assert.equal(agenda.state.checks, 200, "el almacén avisó las 200 veces");
  assert.equal(agenda.state.renders, 1, "Agenda: ningún dibujo nuevo");
  assert.equal(lista.state.renders, 1, "Lista: ningún dibujo nuevo");
  assert.equal(before.state.renders, 201, "con la lista entera se redibujaba en cada cambio");

  // Cambios en su propia columna que no cambian el motivo: tampoco.
  edit(a1.id, { title: "Otro título", subtaskTotal: 4 });
  edit(l1.id, { title: "Otro", dueDate: "2026-12-05" });
  assert.equal(agenda.state.renders, 1);
  assert.equal(lista.state.renders, 1);

  // Cambia el motivo de la Agenda (una tarjeta ya tiene fecha): se redibuja ese botón, una vez, y no el de la Lista.
  edit(a1.id, { dueDate: "2026-12-06" });
  assert.equal(agenda.state.value, null);
  assert.equal(agenda.state.renders, 2);
  assert.equal(lista.state.renders, 1);
  // Otra con fecha: el motivo sigue siendo «ninguno».
  edit(a2.id, { dueDate: "2026-12-07" });
  assert.equal(agenda.state.renders, 2);
  // Se quitan las dos fechas: vuelve el motivo.
  edit(a1.id, { dueDate: null });
  assert.equal(agenda.state.renders, 2);
  edit(a2.id, { dueDate: null });
  assert.equal(agenda.state.value, "noDueDate");
  assert.equal(agenda.state.renders, 3);
  // Una tarjeta con fecha llega de otra columna.
  edit(big[1]!.id, { columnId: "agenda", dueDate: "2026-12-08" });
  assert.equal(agenda.state.value, null);
  // La Lista, igual con las subtareas.
  edit(l1.id, { subtaskTotal: 2 });
  assert.equal(lista.state.value, null);
  assert.equal(lista.state.renders, 2);

  agenda.stop();
  lista.stop();
  before.stop();
});

test("instantánea: una sola pasada por lista de tareas y columna, y «sin tarjetas» sin mirar la lista", () => {
  let reads = 0;
  const list = Array.from({ length: 50 }, () => task("agenda"));
  const counted = list.map((x) => Object.defineProperty({ ...x }, "dueDate", { get: () => (reads++, null), enumerable: true }));
  const store = createStore<BoardTask[]>(counted);
  const snap = columnGateSnapshot(store, "agenda", "AGENDA", 50);
  assert.equal(snap(), "noDueDate");
  assert.equal(reads, 50);
  // El botón de la cabecera y el del menú piden lo mismo, y React la pide en cada dibujo: no se vuelve a recorrer.
  for (let i = 0; i < 20; i++) assert.equal(columnGateSnapshot(store, "agenda", "AGENDA", 50)(), "noDueDate");
  assert.equal(reads, 50);
  // Otra columna u otro rol sobre la misma lista: su propia pasada, sin mezclar resultados.
  assert.equal(columnGateSnapshot(store, "agenda", "CHECKLIST", 50)(), "noSubtasks");
  assert.equal(columnGateSnapshot(store, "otra", "AGENDA", 3)(), "noDueDate");
  assert.equal(snap(), "noDueDate");
  // Sin tarjetas a la vista no hace falta la lista.
  const empty = columnGateSnapshot({ get: () => assert.fail("no debe leer el almacén") }, "agenda", "AGENDA", 0);
  assert.equal(empty(), "empty");
});
