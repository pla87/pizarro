// Orden de los proyectos en el selector y las listas (sortProjects): usados recientemente o alfabético.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sortProjects } from "../src/lib/project-order";

const at = (iso: string) => new Date(iso);

describe("sortProjects", () => {
  const rows = [
    { name: "Beta", visitedAt: null },
    { name: "alfa", visitedAt: at("2026-11-01T10:00:00Z") },
    { name: "Gamma", visitedAt: null },
    { name: "Delta", visitedAt: at("2026-11-03T10:00:00Z") },
  ];

  test("usados recientemente: el último abierto primero; los nunca abiertos, después y en el orden recibido", () => {
    assert.deepEqual(sortProjects(rows, "RECENT", "es").map((r) => r.name), ["Delta", "alfa", "Beta", "Gamma"]);
    // Sin ninguna apertura: tal cual (la lista de siempre).
    const none = rows.map((r) => ({ ...r, visitedAt: null }));
    assert.deepEqual(sortProjects(none, "RECENT", "es").map((r) => r.name), ["Beta", "alfa", "Gamma", "Delta"]);
  });

  test("alfabético: sin distinguir mayúsculas ni acentos, números por su valor, espacios del principio fuera", () => {
    const names = ["Zeta", "  Ñu", "árbol", "Arco", "Nube", "Fase 10", "Fase 2", "éxito", "Oso"];
    const sorted = sortProjects(names.map((name) => ({ name })), "ALPHABETICAL", "es").map((r) => r.name);
    assert.deepEqual(sorted, ["árbol", "Arco", "éxito", "Fase 2", "Fase 10", "Nube", "  Ñu", "Oso", "Zeta"]);
  });

  test("alfabético: a igual nombre se respeta el orden recibido; no modifica la lista original", () => {
    const input = [{ name: "Casa", id: 1 }, { name: "casa", id: 2 }, { name: "Abeto", id: 3 }];
    const out = sortProjects(input, "ALPHABETICAL", "en");
    assert.deepEqual(out.map((r) => r.id), [3, 1, 2]);
    assert.deepEqual(input.map((r) => r.id), [1, 2, 3]);
  });
});
