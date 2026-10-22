import assert from "node:assert/strict";
import { test } from "node:test";
import { activeFilterCount, EMPTY_FILTERS, NO_ASSIGNEE, parseStoredFilters, sanitizeFilters, taskMatchesFilters, type BoardFilters } from "../src/components/board/filters";
import type { BoardTask } from "../src/lib/types";

// 2026-10-22 es jueves: la semana va del 19 al 25.
const ctx = { currentUserId: "me", today: "2026-10-22", doneColumnIds: new Set(["done"]) };

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "t", columnId: "todo", title: "x", kindId: "k1", color: null, linkUrl: null, position: 1, assigneeId: null, labelIds: [],
  subtaskTotal: 0, subtaskDone: 0, attachmentCount: 0, hasDescription: false, dueDate: null, deliverableId: null, commentCount: 0,
  linkCount: 0, evergreen: false, recurrence: "NONE", recurrenceDay: null, textVersion: null, ...over,
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
