import assert from "node:assert/strict";
import { test } from "node:test";
import { activeFilterCount, EMPTY_FILTERS, NO_ASSIGNEE, parseStoredFilters, sanitizeFilters, searchTerms, taskMatchesFilters, taskSearchText, type BoardFilters, type SearchNames } from "../src/components/board/filters";
import type { BoardTask } from "../src/lib/types";

// 2026-10-22 es jueves: la semana va del 19 al 25.
const ctx = { currentUserId: "me", today: "2026-10-22", doneColumnIds: new Set(["done"]) };

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "t", columnId: "todo", title: "x", kindId: "k1", color: null, linkUrl: null, position: 1, assigneeId: null, labelIds: [],
  subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0, hasDescription: false, dueDate: null, deliverableId: null, commentCount: 0,
  linkCount: 0, evergreen: false, evergreenEvery: 1, recurrence: "NONE", recurrenceDay: null, textVersion: null, columnEnteredAt: "2026-10-01T00:00:00.000Z",
  cost: null, costPaid: false, estimatedHours: null, actualHours: null, priority: null, client: null, startDate: null, ...over,
});
const f = (over: Partial<BoardFilters>): BoardFilters => ({ ...EMPTY_FILTERS, ...over });
const match = (t: Partial<BoardTask>, filters: Partial<BoardFilters>) => taskMatchesFilters(task(t), f(filters), ctx);

test("sin filtros todo pasa y el contador es 0", () => {
  assert.equal(match({}, {}), true);
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
});

test("mis tareas", () => {
  assert.equal(match({ assigneeId: "me" }, { mine: true }), true);
  assert.equal(match({ assigneeId: "otro" }, { mine: true }), false);
  assert.equal(match({ assigneeId: null }, { mine: true }), false);
});

test("vencidas: fecha pasada y fuera de columnas terminadas", () => {
  assert.equal(match({ dueDate: "2026-10-21" }, { overdue: true }), true);
  assert.equal(match({ dueDate: "2026-10-22" }, { overdue: true }), false);
  assert.equal(match({ dueDate: null }, { overdue: true }), false);
  assert.equal(match({ dueDate: "2026-10-01", columnId: "done" }, { overdue: true }), false);
});

test("esta semana: de lunes a domingo", () => {
  assert.equal(match({ dueDate: "2026-10-19" }, { week: true }), true);
  assert.equal(match({ dueDate: "2026-10-25" }, { week: true }), true);
  assert.equal(match({ dueDate: "2026-10-18" }, { week: true }), false);
  assert.equal(match({ dueDate: "2026-10-26" }, { week: true }), false);
  assert.equal(match({ dueDate: null }, { week: true }), false);
});

test("etiquetas y tipos: basta una; entre grupos, todas", () => {
  assert.equal(match({ labelIds: ["a", "b"] }, { labelIds: ["b", "c"] }), true);
  assert.equal(match({ labelIds: ["a"] }, { labelIds: ["b", "c"] }), false);
  assert.equal(match({ labelIds: [] }, { labelIds: ["b"] }), false);
  assert.equal(match({ kindId: "k2" }, { kindIds: ["k1", "k2"] }), true);
  assert.equal(match({ kindId: "k3" }, { kindIds: ["k1", "k2"] }), false);
  assert.equal(match({ kindId: "k1", labelIds: ["a"] }, { kindIds: ["k1"], labelIds: ["b"] }), false);
  assert.equal(match({ kindId: "k1", labelIds: ["a"] }, { kindIds: ["k1"], labelIds: ["a"] }), true);
});

test("responsable", () => {
  assert.equal(match({ assigneeId: "u1" }, { assigneeId: "u1" }), true);
  assert.equal(match({ assigneeId: "u2" }, { assigneeId: "u1" }), false);
  assert.equal(match({ assigneeId: null }, { assigneeId: NO_ASSIGNEE }), true);
  assert.equal(match({ assigneeId: "u1" }, { assigneeId: NO_ASSIGNEE }), false);
});

test("contador: cada grupo cuenta una vez", () => {
  assert.equal(activeFilterCount(f({ mine: true, labelIds: ["a", "b"], assigneeId: NO_ASSIGNEE })), 3);
});

test("lo guardado se lee con tolerancia", () => {
  assert.deepEqual(parseStoredFilters(null), EMPTY_FILTERS);
  assert.deepEqual(parseStoredFilters("no es json"), EMPTY_FILTERS);
  assert.deepEqual(parseStoredFilters("42"), EMPTY_FILTERS);
  assert.deepEqual(parseStoredFilters(JSON.stringify({ mine: true, labelIds: ["a", 3, "a"], kindIds: "x", assigneeId: 7 })), f({ mine: true, labelIds: ["a"] }));
});

test("se descartan etiquetas, tipos y personas que ya no existen", () => {
  const valid = { labels: new Set(["a"]), kinds: new Set(["k1"]), users: new Set(["u1"]) };
  const clean = sanitizeFilters(f({ labelIds: ["a", "z"], kindIds: ["q"], assigneeId: "gone" }), valid);
  assert.deepEqual(clean, f({ labelIds: ["a"] }));
  const same = f({ labelIds: ["a"], assigneeId: NO_ASSIGNEE });
  assert.equal(sanitizeFilters(same, valid), same);
});

// Buscador del tablero: texto normalizado de cada tarea, calculado una vez por versión de la tarea (objeto) y juego de nombres.
const names = (over: Partial<SearchNames> = {}): SearchNames => ({
  kindName: new Map([["k1", "Error crítico"]]), userName: new Map([["u1", "Ángela Núñez"]]), labelName: new Map([["l1", "Diseño"]]), clientEnabled: false, ...over,
});
/** Tarea cuyo título cuenta las lecturas: si el texto sale de la caché, no se vuelve a leer ni a normalizar. */
const counted = (title: string) => {
  const t = task({});
  let reads = 0;
  Object.defineProperty(t, "title", { get: () => (reads++, title), enumerable: true });
  return { t, reads: () => reads };
};

test("buscador: título (con menciones), tipo, responsable, etiquetas y cliente, sin tildes ni mayúsculas", () => {
  const text = taskSearchText(task({ title: "Revisar la CANCIÓN con @[Ana](user:u9)", assigneeId: "u1", labelIds: ["l1", "borrada"], client: "Acme Óptica" }), names());
  for (const w of ["revisar", "cancion", "@ana", "error", "critico", "angela", "nunez", "diseno"]) assert.ok(text.includes(w), `${w} en «${text}»`);
  assert.ok(!text.includes("acme"), "el cliente solo cuenta con el campo activado");
  assert.ok(taskSearchText(task({ title: "x", client: "Acme Óptica" }), names({ clientEnabled: true })).includes("acme optica"));
  assert.deepEqual(searchTerms("  Canción   ÁNGELA "), ["cancion", "angela"]);
  assert.deepEqual(searchTerms("   "), []);
});

test("buscador: cada tarea se normaliza una vez por versión; otra versión u otros nombres, de nuevo", () => {
  const n = names();
  const a = counted("Pedido Nº 4");
  const first = taskSearchText(a.t, n);
  assert.equal(a.reads(), 1);
  // Más pulsaciones con los mismos datos: ni se vuelve a leer ni a normalizar.
  for (let i = 0; i < 5; i++) assert.equal(taskSearchText(a.t, n), first);
  assert.equal(a.reads(), 1);
  // Cambia otra tarea (objeto nuevo): solo esa se calcula.
  const b = counted("Pedido Nº 5");
  assert.ok(taskSearchText(b.t, n).startsWith("pedido nº 5"));
  assert.equal(b.reads(), 1);
  assert.equal(taskSearchText(a.t, n), first);
  assert.equal(a.reads(), 1);
  // Otros nombres (p. ej. una etiqueta renombrada): se calcula de nuevo con ellos.
  taskSearchText(a.t, names({ labelName: new Map([["l1", "Maquetación"]]) }));
  assert.equal(a.reads(), 2);
});
