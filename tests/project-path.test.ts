import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSwitchPath } from "../src/lib/project-path";

test("el tablero se mantiene en el tablero", () => {
  assert.equal(projectSwitchPath("/p/A", "", "B"), "/p/B");
  assert.equal(projectSwitchPath("/p/A/", "", "B"), "/p/B");
});

test("se descartan ?task= y otros parámetros propios del proyecto, se conserva ?archivadas", () => {
  assert.equal(projectSwitchPath("/p/A", "?task=t1", "B"), "/p/B");
  assert.equal(projectSwitchPath("/p/A", "?archivadas=1&task=t1&label=x", "B"), "/p/B?archivadas=1");
});

test("ajustes y releases se conservan", () => {
  assert.equal(projectSwitchPath("/p/A/settings", "", "B"), "/p/B/settings");
  assert.equal(projectSwitchPath("/p/A/releases", "", "B"), "/p/B/releases");
  assert.equal(projectSwitchPath("/p/A/releases", "?q=hola&limit=50&release=r1", "B"), "/p/B/releases?q=hola");
});

test("subrutas más profundas caen al índice de la sección", () => {
  assert.equal(projectSwitchPath("/p/A/releases/r1", "", "B"), "/p/B/releases");
  assert.equal(projectSwitchPath("/p/A/settings/x/y", "", "B"), "/p/B/settings");
});

test("sin permiso para los ajustes del destino, vuelve al tablero", () => {
  assert.equal(projectSwitchPath("/p/A/settings", "", "B", { canOpenSettings: false }), "/p/B");
  assert.equal(projectSwitchPath("/p/A/settings", "", "B", { canOpenSettings: true }), "/p/B/settings");
  // Se conserva la pestaña de ajustes (la página abre la primera disponible si el usuario no ve esa).
  assert.equal(projectSwitchPath("/p/A/settings", "?tab=releases&x=1", "B"), "/p/B/settings?tab=releases");
});

test("rutas desconocidas o fuera de un proyecto van al tablero", () => {
  assert.equal(projectSwitchPath("/p/A/otra", "", "B"), "/p/B");
  assert.equal(projectSwitchPath("/my-tasks", "", "B"), "/p/B");
  assert.equal(projectSwitchPath("/", "", "B"), "/p/B");
});
