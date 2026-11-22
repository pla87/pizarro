// Visitas de página: una por persona y página cada 15 minutos, con tope de memoria.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_VIEW_DEDUP_MS, PAGE_VIEW_KEY_PATH_MAX, PAGE_VIEW_MAX_KEYS, pageViewDue } from "../src/lib/page-view";

test("pageViewDue: una visita por persona y página en la ventana", () => {
  const state = new Map<string, number>();
  const t0 = 1_000_000;
  assert.equal(pageViewDue(state, "u1", "/my-tasks", t0), true);
  assert.equal(pageViewDue(state, "u1", "/my-tasks", t0 + PAGE_VIEW_DEDUP_MS - 1), false);
  assert.equal(pageViewDue(state, "u2", "/my-tasks", t0 + 1), true);
  assert.equal(pageViewDue(state, "u1", "/calendar", t0 + 1), true);
  assert.equal(pageViewDue(state, "u1", "/my-tasks", t0 + PAGE_VIEW_DEDUP_MS), true);
});

test("pageViewDue: la clave lleva la ruta recortada", () => {
  const state = new Map<string, number>();
  const base = "/my-tasks?x=" + "a".repeat(PAGE_VIEW_KEY_PATH_MAX);
  assert.equal(pageViewDue(state, "u1", base + "1".repeat(16_000), 0), true);
  // Mismos primeros caracteres: cuenta como la misma visita.
  assert.equal(pageViewDue(state, "u1", base + "2".repeat(16_000), 1), false);
  for (const k of state.keys()) assert.ok(k.length <= PAGE_VIEW_KEY_PATH_MAX + "u1 ".length);
});

test("pageViewDue: tope duro, sale la anotada hace más tiempo", () => {
  const state = new Map<string, number>();
  // Todas vivas (dentro de la ventana): el mapa no pasa del tope.
  for (let i = 0; i < PAGE_VIEW_MAX_KEYS + 1000; i++) pageViewDue(state, "u1", `/p/${i}`, i);
  assert.equal(state.size, PAGE_VIEW_MAX_KEYS);
  assert.equal(state.has("u1 /p/0"), false);
  assert.equal(state.has(`u1 /p/${PAGE_VIEW_MAX_KEYS + 999}`), true);
  // Volver a anotar una clave la pone al final: ya no es la siguiente en salir.
  const first = state.keys().next().value!;
  assert.equal(pageViewDue(state, "u1", first.slice(3), PAGE_VIEW_DEDUP_MS * 2), true);
  assert.notEqual(state.keys().next().value, first);
  assert.equal(state.size, PAGE_VIEW_MAX_KEYS);
});
