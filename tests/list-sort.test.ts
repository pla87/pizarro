import assert from "node:assert/strict";
import { test } from "node:test";
import { ariaSortOf, DEFAULT_LIST_SORT, nextSort, parseStoredView, parseViewParam, sortTasks, type ListSort, type ListSortContext } from "../src/components/board/listSort";
import type { BoardTask } from "../src/lib/types";

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "t", columnId: "c1", title: "x", kindId: "k1", color: null, linkUrl: null, position: 1, assigneeId: null, labelIds: [],
  subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0, hasDescription: false, dueDate: null, deliverableId: null, commentCount: 0,
  linkCount: 0, evergreen: false, evergreenEvery: 1, recurrence: "NONE", recurrenceDay: null, textVersion: null, columnEnteredAt: "2026-10-01T00:00:00.000Z",
  cost: null, costPaid: false, estimatedHours: null, actualHours: null, priority: null, client: null, startDate: null,
  ...over,
});

const ctx = (locale = "es-ES"): ListSortContext => ({
  columnPosition: new Map([["c1", 1], ["c2", 2], ["c3", 3]]),
  userName: new Map([["u1", "Álvaro"], ["u2", "Zoe"], ["u3", "Ana"]]),
  labelName: new Map([["l1", "Urgente"], ["l2", "Árbol"]]),
  locale,
});
const ids = (ts: BoardTask[]) => ts.map((t) => t.id).join(",");
const by = (key: ListSort["key"], dir: ListSort["dir"] = "asc"): ListSort => ({ key, dir });

test("por defecto: columna del tablero y posición, sin depender del orden de entrada", () => {
  const ts = [task({ id: "d", columnId: "c2", position: 1 }), task({ id: "b", position: 2 }), task({ id: "c", columnId: "c3" }), task({ id: "a", position: 1 })];
  assert.equal(ids(sortTasks(ts, DEFAULT_LIST_SORT, ctx())), "a,b,d,c");
  assert.equal(ids(sortTasks([...ts].reverse(), DEFAULT_LIST_SORT, ctx())), "a,b,d,c");
  assert.equal(ids(sortTasks(ts, by("column", "desc"), ctx())), "c,d,a,b");
});

test("no modifica el array de entrada", () => {
  const ts = [task({ id: "b", position: 2 }), task({ id: "a", position: 1 })];
  sortTasks(ts, DEFAULT_LIST_SORT, ctx());
  assert.equal(ids(ts), "b,a");
});

test("fechas vacías al final, también en descendente", () => {
  const ts = [task({ id: "none1", position: 1 }), task({ id: "late", dueDate: "2026-12-01", position: 2 }), task({ id: "soon", dueDate: "2026-11-02", position: 3 }), task({ id: "none2", position: 4 })];
  assert.equal(ids(sortTasks(ts, by("due"), ctx())), "soon,late,none1,none2");
  assert.equal(ids(sortTasks(ts, by("due", "desc"), ctx())), "late,soon,none1,none2");
});

test("títulos con acentos y mayúsculas: localeCompare es y en", () => {
  const ts = [task({ id: "z", title: "Zorro" }), task({ id: "a2", title: "árbol" }), task({ id: "e", title: "Éxito" }), task({ id: "b", title: "Barco" }), task({ id: "a1", title: "Avión" })];
  // «árbol» va antes que «Avión» (ar < av) y «Éxito» entre «Barco» y «Zorro», no al final como con el orden por código.
  assert.equal(ids(sortTasks(ts, by("title"), ctx("es-ES"))), "a2,a1,b,e,z");
  assert.equal(ids(sortTasks(ts, by("title"), ctx("en-GB"))), "a2,a1,b,e,z");
  assert.equal(ids(sortTasks(ts, by("title", "desc"), ctx())), "z,e,b,a1,a2");
});

test("títulos: números naturales", () => {
  const ts = [task({ id: "t10", title: "Tarea 10" }), task({ id: "t2", title: "Tarea 2" })];
  assert.equal(ids(sortTasks(ts, by("title"), ctx())), "t2,t10");
});

test("responsable por nombre con acentos y sin responsable al final", () => {
  const ts = [task({ id: "n", position: 1 }), task({ id: "zoe", assigneeId: "u2", position: 2 }), task({ id: "alv", assigneeId: "u1", position: 3 }), task({ id: "ana", assigneeId: "u3", position: 4 })];
  assert.equal(ids(sortTasks(ts, by("assignee"), ctx())), "alv,ana,zoe,n");
  assert.equal(ids(sortTasks(ts, by("assignee", "desc"), ctx())), "zoe,ana,alv,n");
});

test("prioridad por gravedad (no alfabética) y sin prioridad al final", () => {
  const ts = [task({ id: "n", position: 1 }), task({ id: "alta", priority: "ALTA", position: 2 }), task({ id: "baja", priority: "BAJA", position: 3 }), task({ id: "urg", priority: "URGENTE", position: 4 })];
  assert.equal(ids(sortTasks(ts, by("priority"), ctx())), "baja,alta,urg,n");
  assert.equal(ids(sortTasks(ts, by("priority", "desc"), ctx())), "urg,alta,baja,n");
});

test("etiquetas y subtareas; los empates caen al orden del tablero", () => {
  const ts = [
    task({ id: "none", position: 1 }),
    task({ id: "urg", labelIds: ["l1"], position: 2, subtaskTotal: 4, subtaskDone: 1 }),
    task({ id: "arb", labelIds: ["l2"], position: 3, subtaskTotal: 2, subtaskDone: 2 }),
    task({ id: "arb2", labelIds: ["l2"], position: 4, subtaskTotal: 4, subtaskDone: 1 }),
  ];
  assert.equal(ids(sortTasks(ts, by("labels"), ctx())), "arb,arb2,urg,none");
  assert.equal(ids(sortTasks(ts, by("subtasks"), ctx())), "urg,arb2,arb,none");
  assert.equal(ids(sortTasks(ts, by("subtasks", "desc"), ctx())), "arb,urg,arb2,none");
});

test("1000 tareas se ordenan al instante", () => {
  const ts = Array.from({ length: 1000 }, (_, i) => task({ id: `t${i}`, title: `Tarea ${(i * 7919) % 1000}`, position: i, dueDate: i % 3 ? null : `2026-11-${String(1 + (i % 28)).padStart(2, "0")}` }));
  const start = performance.now();
  const out = sortTasks(ts, by("title"), ctx());
  assert.equal(out.length, 1000);
  assert.ok(performance.now() - start < 500);
});

test("clic en cabecera, aria-sort y vista recordada", () => {
  assert.deepEqual(nextSort(DEFAULT_LIST_SORT, "due"), { key: "due", dir: "asc" });
  assert.deepEqual(nextSort({ key: "due", dir: "asc" }, "due"), { key: "due", dir: "desc" });
  assert.deepEqual(nextSort({ key: "due", dir: "desc" }, "due"), { key: "due", dir: "asc" });
  assert.equal(ariaSortOf({ key: "due", dir: "desc" }, "due"), "descending");
  assert.equal(ariaSortOf({ key: "due", dir: "asc" }, "due"), "ascending");
  assert.equal(ariaSortOf({ key: "due", dir: "asc" }, "title"), "none");
  assert.equal(parseViewParam("lista"), "list");
  assert.equal(parseViewParam("tablero"), "board");
  assert.equal(parseViewParam("otra"), null);
  assert.equal(parseViewParam(null), null);
  assert.equal(parseStoredView("list"), "list");
  assert.equal(parseStoredView("???"), "board");
  assert.equal(parseStoredView(null), "board");
});
