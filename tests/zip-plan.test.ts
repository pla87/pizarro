import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { partSuffix, planPackages, type PlanItem } from "../src/lib/zip-plan";

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
