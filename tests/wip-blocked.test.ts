// Límite de tarjetas por columna (WIP) y tareas bloqueadas: lógica pura, sin base de datos.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sameTask } from "../src/components/board/sameTask";
import { blockerIsDone, wouldCycle } from "../src/lib/blocked";
import { assertNoBlockCycles } from "../src/lib/project-export/read";
import type { BoardTask } from "../src/lib/types";
import { buildTemplateApplication, templateInputSchema } from "../src/lib/project-templates";
import { isValidWipLimit, parseWipInput, wipExceeded } from "../src/lib/wip";

describe("límite de tarjetas (WIP): aviso calculado", () => {
  test("solo avisa al PASAR el límite, no al alcanzarlo", () => {
    assert.equal(wipExceeded(2, 3), false);
    assert.equal(wipExceeded(3, 3), false);
    assert.equal(wipExceeded(4, 3), true);
  });
  test("sin límite nunca avisa", () => {
    assert.equal(wipExceeded(500, null), false);
    assert.equal(wipExceeded(500, undefined), false);
  });
  test("con límite 1, una sola tarjeta no avisa y dos sí", () => {
    assert.equal(wipExceeded(1, 1), false);
    assert.equal(wipExceeded(2, 1), true);
  });
  test("límite válido: entero de 1 a 999", () => {
    for (const ok of [1, 5, 999]) assert.equal(isValidWipLimit(ok), true);
    for (const bad of [0, -1, 1000, 1.5, NaN, "3", null]) assert.equal(isValidWipLimit(bad), false);
  });
  test("lo que se escribe: vacío = sin límite, número válido, el resto no vale", () => {
    assert.equal(parseWipInput(""), null);
    assert.equal(parseWipInput("   "), null);
    assert.equal(parseWipInput(" 7 "), 7);
    assert.equal(parseWipInput("999"), 999);
    for (const bad of ["0", "1000", "-2", "1.5", "abc", "1e2", "0003x"]) assert.equal(parseWipInput(bad), undefined, bad);
  });
});

describe("plantillas de proyecto y límite de tarjetas", () => {
  const base = { name: "P", columns: [{ name: "A", role: "NONE", isDone: false, wipLimit: 3 }, { name: "B", role: "NONE", isDone: false }], kinds: [], hiddenGeneralKinds: [], labels: [] };
  test("la plantilla conserva el límite y lo aplica al proyecto nuevo", () => {
    const tpl = templateInputSchema.parse(base);
    assert.equal(tpl.columns[0]!.wipLimit, 3);
    const app = buildTemplateApplication(tpl, []);
    assert.deepEqual(app.columns.map((c) => c.wipLimit), [3, null]);
  });
  test("un límite fuera de 1-999 invalida la plantilla", () => {
    assert.equal(templateInputSchema.safeParse({ ...base, columns: [{ name: "A", role: "NONE", isDone: false, wipLimit: 0 }] }).success, false);
    assert.equal(templateInputSchema.safeParse({ ...base, columns: [{ name: "A", role: "NONE", isDone: false, wipLimit: 1000 }] }).success, false);
  });
});

describe("tareas bloqueadas: ciclos y fin del bloqueo", () => {
  const chain: Record<string, string | null> = { a: "b", b: "c", c: null };
  const next = (id: string) => chain[id] ?? null;
  test("bloquearse a sí misma es un ciclo", () => {
    assert.equal(wouldCycle("a", "a", next), true);
  });
  test("A→B y bloquear B por A cierra un ciclo directo", () => {
    assert.equal(wouldCycle("b", "a", next), true);
  });
  test("también los ciclos largos (A→B→C y C por A)", () => {
    assert.equal(wouldCycle("c", "a", next), true);
  });
  test("una cadena sin vuelta no es un ciclo", () => {
    assert.equal(wouldCycle("a", "c", next), false);
    assert.equal(wouldCycle("x", "a", next), false);
  });
  test("un ciclo que ya existiera en los datos no cuelga el cálculo", () => {
    const loop = (id: string) => (id === "p" ? "q" : "p");
    assert.equal(wouldCycle("z", "p", loop, 50), false);
  });
  const columns = [{ id: "todo", isDone: false }, { id: "done", isDone: true }];
  test("el bloqueo deja de avisar si la que bloquea está archivada (no está en el tablero) o en columna terminada", () => {
    assert.equal(blockerIsDone(undefined, columns), true);
    assert.equal(blockerIsDone({ columnId: "done" }, columns), true);
    assert.equal(blockerIsDone({ columnId: "todo" }, columns), false);
  });
});

describe("importar: validación de bloqueos en círculo (lineal)", () => {
  test("una cadena de 100.000 tareas se valida enseguida y sin desbordar la pila", () => {
    const n = 100_000;
    const m = new Map<string, string>();
    for (let i = 0; i < n - 1; i++) m.set(`t${i}`, `t${i + 1}`);
    const t0 = Date.now();
    assert.doesNotThrow(() => assertNoBlockCycles(m));
    assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms`);
  });
  test("detecta un círculo al final de una cadena larga, uno directo y uno de una sola tarea", () => {
    const n = 100_000;
    const m = new Map<string, string>();
    for (let i = 0; i < n - 1; i++) m.set(`t${i}`, `t${i + 1}`);
    m.set(`t${n - 1}`, "t50000");
    const t0 = Date.now();
    assert.throws(() => assertNoBlockCycles(m), /en círculo/);
    assert.ok(Date.now() - t0 < 1000);
    assert.throws(() => assertNoBlockCycles(new Map([["a", "b"], ["b", "a"]])), /en círculo/);
    assert.throws(() => assertNoBlockCycles(new Map([["a", "a"]])), /en círculo/);
  });
  test("varias tareas bloqueadas por la misma, sin círculo, valen", () => {
    assert.doesNotThrow(() => assertNoBlockCycles(new Map([["a", "x"], ["b", "x"], ["c", "a"], ["d", "c"]])));
  });
});

describe("tablero: sameTask no invalida tarjetas por un blockedBy nuevo pero igual", () => {
  const base = { id: "t1", title: "Hola", columnId: "c1", labelIds: ["l1"], blockedBy: { id: "b1", title: "Otra" } } as unknown as BoardTask;
  const withBlocked = (blockedBy: unknown) => ({ ...base, blockedBy }) as unknown as BoardTask;
  test("mismo id y título en objetos distintos: igual", () => {
    assert.equal(sameTask(base, withBlocked({ id: "b1", title: "Otra" })), true);
  });
  test("cambia el id o el título: distinta", () => {
    assert.equal(sameTask(base, withBlocked({ id: "b2", title: "Otra" })), false);
    assert.equal(sameTask(base, withBlocked({ id: "b1", title: "Otra cosa" })), false);
  });
  test("null y undefined cuentan como sin bloqueo, y distinto de uno con bloqueo", () => {
    assert.equal(sameTask(withBlocked(null), withBlocked(undefined)), true);
    assert.equal(sameTask(withBlocked(null), withBlocked(null)), true);
    assert.equal(sameTask(base, withBlocked(null)), false);
    assert.equal(sameTask(withBlocked(undefined), base), false);
  });
  test("las listas de valores siguen comparándose por contenido", () => {
    assert.equal(sameTask(base, { ...base, labelIds: ["l1"] } as BoardTask), true);
    assert.equal(sameTask(base, { ...base, labelIds: ["l2"] } as BoardTask), false);
  });
});
