import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { partSuffix, planPackages, type PlanItem } from "../src/lib/zip-plan";
import { zipPlanToken } from "../src/lib/zip-token";
import { zipRequestMode, zipVersionConflict } from "../src/lib/release-zip";

const items = (...sizes: number[]): PlanItem[] => sizes.map((size, index) => ({ index, size }));

describe("planPackages", () => {
  test("sin ficheros no hay paquetes", () => assert.deepEqual(planPackages([], 100), []));

  test("si todo cabe, un solo paquete con el orden original", () => {
    const p = planPackages(items(30, 10, 50), 100);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0], { items: [0, 1, 2], bytes: 90, oversize: false });
  });

  test("encaja en el mínimo práctico de paquetes y respeta el tope", () => {
    const p = planPackages(items(60, 50, 50, 40, 30, 30), 100);
    assert.equal(p.length, 3);
    for (const pk of p) assert.ok(pk.bytes <= 100);
    assert.equal(p.reduce((n, pk) => n + pk.bytes, 0), 260);
    // Cada fichero aparece exactamente una vez.
    assert.deepEqual(p.flatMap((x) => x.items).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });

  test("un fichero mayor que el tope va solo y marcado", () => {
    const p = planPackages(items(20, 250, 30), 100);
    assert.equal(p.length, 2);
    const big = p.find((x) => x.oversize)!;
    assert.deepEqual(big.items, [1]);
    const rest = p.find((x) => !x.oversize)!;
    assert.deepEqual(rest.items, [0, 2]);
  });

  test("un fichero igual al tope cabe sin marcarse", () => {
    const p = planPackages(items(100, 1), 100);
    assert.equal(p.length, 2);
    assert.ok(p.every((x) => !x.oversize));
  });

  test("es determinista con tamaños iguales", () => {
    const a = planPackages(items(40, 40, 40, 40, 40), 100);
    const b = planPackages(items(40, 40, 40, 40, 40), 100);
    assert.deepEqual(a, b);
    assert.equal(a.length, 3);
  });
});

test("partSuffix", () => {
  assert.equal(partSuffix(1, 1), "");
  assert.equal(partSuffix(2, 3), "-2de3");
});

describe("zipPlanToken", () => {
  const files = [{ id: "a1", size: 10 }, { id: "b2", size: 20 }];

  test("es estable y de 16 hex", () => {
    assert.equal(zipPlanToken(files, 25), zipPlanToken([...files], 25));
    assert.match(zipPlanToken(files, 25), /^[0-9a-f]{16}$/);
  });

  test("cambia con el id, el tamaño, el orden o el tope", () => {
    const base = zipPlanToken(files, 25);
    assert.notEqual(zipPlanToken([{ id: "a1", size: 10 }, { id: "c3", size: 20 }], 25), base);
    assert.notEqual(zipPlanToken([{ id: "a1", size: 11 }, { id: "b2", size: 20 }], 25), base);
    assert.notEqual(zipPlanToken([files[1]!, files[0]!], 25), base);
    assert.notEqual(zipPlanToken(files, 50), base);
    assert.notEqual(zipPlanToken(files.slice(0, 1), 25), base);
  });

  test("no confunde fronteras entre ficheros", () => {
    assert.notEqual(zipPlanToken([{ id: "a", size: 12 }], 5), zipPlanToken([{ id: "a1", size: 2 }], 5));
  });
});

describe("zipRequestMode y conflicto de versión", () => {
  const entries = [{ id: "a1", name: "x", size: 10, read: async () => new Uint8Array() }];
  const v = zipPlanToken(entries, 25);
  const part = (q: string) => zipRequestMode(`http://x/api?${q}`)!;

  test("lee ?v= y rechaza uno mal formado", () => {
    assert.deepEqual(part(`part=2&v=${v}`), { kind: "part", part: 2, explicit: true, version: v });
    assert.deepEqual(part("part=2"), { kind: "part", part: 2, explicit: true, version: null });
    assert.equal(zipRequestMode("http://x/api?part=1&v=zz"), null);
  });

  test("sin ?v= no hay conflicto (enlaces antiguos); con token igual tampoco; distinto, 409", async () => {
    assert.equal(zipVersionConflict(part("part=1"), entries, 25, "m"), null);
    assert.equal(zipVersionConflict(part(`part=1&v=${v}`), entries, 25, "m"), null);
    assert.equal(zipVersionConflict({ kind: "plan" }, entries, 25, "m"), null);
    const changed = [...entries, { id: "b2", name: "y", size: 5, read: async () => new Uint8Array() }];
    const res = zipVersionConflict(part(`part=1&v=${v}`), changed, 25, "Cambiaron");
    assert.equal(res?.status, 409);
    assert.equal(await res?.text(), "Cambiaron");
  });
});
