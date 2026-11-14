// Turnos de los movimientos de tarjetas (moveTurns.ts): la respuesta de un movimiento anterior no pisa lo que ya ha pintado
// uno posterior de la misma tarjeta (Alt+→ y Alt+← seguidos antes de que responda el servidor).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMoveTurns } from "../src/components/board/moveTurns";

test("el último movimiento de cada tarjeta es el único que aplica su respuesta", () => {
  const turns = createMoveTurns();
  const right = turns.start(["b"]);
  assert.equal(turns.isLatest("b", right), true);
  // Antes de que responda, otro movimiento de la misma tarjeta: el primero ya no manda.
  const left = turns.start(["b"]);
  assert.equal(turns.isLatest("b", right), false);
  assert.equal(turns.isLatest("b", left), true);
});

test("un movimiento en bloque solo pierde el turno en las tarjetas que se vuelven a mover", () => {
  const turns = createMoveTurns();
  const block = turns.start(["a", "b", "c"]);
  const single = turns.start(["b"]);
  assert.deepEqual(["a", "b", "c"].map((id) => turns.isLatest(id, block)), [true, false, true]);
  assert.equal(turns.isLatest("b", single), true);
  // Otra tarjeta nunca movida no tiene turno.
  assert.equal(turns.isLatest("z", block), false);
});

test("cada tablero lleva sus propios turnos", () => {
  const one = createMoveTurns();
  const two = createMoveTurns();
  const t1 = one.start(["a"]);
  two.start(["a"]);
  assert.equal(one.isLatest("a", t1), true);
});
