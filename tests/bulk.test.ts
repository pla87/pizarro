import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLines } from "../src/lib/bulk";

test("una tarea por línea, sin vacías ni viñetas", () => {
  const text = "- Primera\r\n\n* Segunda  con   espacios\n  3. Tercera\n• Cuarta\n- [ ] Quinta\n[x] Sexta\n2) Séptima\n   \n";
  assert.deepEqual(parseTaskLines(text), ["Primera", "Segunda con espacios", "Tercera", "Cuarta", "Quinta", "Sexta", "Séptima"]);
});

test("respeta números y guiones que forman parte del título", () => {
  assert.deepEqual(parseTaskLines("2026 roadmap\n1.5 release\n-flag nueva\nv2 - login"), ["2026 roadmap", "1.5 release", "-flag nueva", "v2 - login"]);
});

test("recorta títulos demasiado largos", () => {
  assert.equal(parseTaskLines("x".repeat(500))[0]!.length, 210);
});
