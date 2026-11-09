import assert from "node:assert/strict";
import { test } from "node:test";
import { clampLength, subtaskLines } from "../src/lib/subtask-lines";

test("subtareas pegadas: una por línea no vacía, sin viñetas ni casillas", () => {
  const text = "- Comprar pan\r\n* Llamar a Ana\n\n  1. Revisar contrato  \n2) Enviar factura\n[ ] Pendiente\n[x] Hecha\n- [ ] Lista con casilla\n• Punto\n+ Más\n   \n-\nSin viñeta";
  assert.deepEqual(subtaskLines(text, 210), [
    "Comprar pan", "Llamar a Ana", "Revisar contrato", "Enviar factura", "Pendiente", "Hecha", "Lista con casilla", "Punto", "Más", "Sin viñeta",
  ]);
});

test("subtareas pegadas: no confunde números ni guiones del propio texto con viñetas", () => {
  assert.deepEqual(subtaskLines("3.5 horas de revisión\n-5 grados\n2026: plan\nA - B", 210), ["3.5 horas de revisión", "-5 grados", "2026: plan", "A - B"]);
});

test("subtareas pegadas: cada línea se recorta al máximo sin partir emojis", () => {
  const [a, b] = subtaskLines(`${"x".repeat(250)}\n${"y".repeat(9)}😀😀`, 10);
  assert.equal(a, "x".repeat(10));
  assert.equal(b, "y".repeat(9));
  assert.equal(clampLength("abc", 10), "abc");
  assert.equal(clampLength("ab😀", 3), "ab");
});
