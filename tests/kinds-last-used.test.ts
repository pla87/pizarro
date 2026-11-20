// «Nueva tarea» preselecciona el último tipo con el que esa persona creó una tarea en ese proyecto (localStorage).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { initialKindId, rememberKind } from "../src/components/board/lastKind";

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});
function fakeStorage() {
  const map = new Map<string, string>();
  g.window = { localStorage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) } };
  return map;
}
const KINDS = [{ id: "respuesta" }, { id: "error" }, { id: "idea" }];

test("sin nada guardado, el primer tipo", () => {
  fakeStorage();
  assert.equal(initialKindId("u1", "p1", KINDS), "respuesta");
  assert.equal(initialKindId("u1", "p1", []), "");
});

test("recuerda el último por persona y proyecto", () => {
  fakeStorage();
  rememberKind("u1", "p1", "error");
  assert.equal(initialKindId("u1", "p1", KINDS), "error");
  assert.equal(initialKindId("u1", "p2", KINDS), "respuesta", "otro proyecto");
  assert.equal(initialKindId("u2", "p1", KINDS), "respuesta", "otra persona");
  rememberKind("u1", "p1", "idea");
  assert.equal(initialKindId("u1", "p1", KINDS), "idea");
});

test("un tipo borrado u oculto en el proyecto ya no se preselecciona", () => {
  fakeStorage();
  rememberKind("u1", "p1", "error");
  assert.equal(initialKindId("u1", "p1", [{ id: "respuesta" }, { id: "idea" }]), "respuesta");
});

test("sin localStorage (bloqueado o lanza), el primero y sin errores", () => {
  g.window = {
    get localStorage() {
      throw new Error("SecurityError");
    },
  };
  assert.doesNotThrow(() => rememberKind("u1", "p1", "error"));
  assert.equal(initialKindId("u1", "p1", KINDS), "respuesta");
  delete g.window;
  assert.equal(initialKindId("u1", "p1", KINDS), "respuesta");
});
