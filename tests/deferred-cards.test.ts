// Columnas largas del tablero (src/components/board/deferredCards.ts): el servidor pinta solo las primeras tarjetas de
// cada columna, el resto llega por tandas después de hidratar y, mientras tanto, un hueco ocupa lo mismo que ellas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsReserve, FIRST_PAINT_CARDS, FIRST_PAINT_ROWS, nextCardLimit, rowsReserve } from "../src/components/board/deferredCards";

test("primera pintura: entre 40 y 60 tarjetas por columna", () => {
  assert.ok(FIRST_PAINT_CARDS >= 40 && FIRST_PAINT_CARDS <= 60);
});

test("después de hidratar, tanda a tanda hasta todas (y entonces sin tope)", () => {
  let limit = FIRST_PAINT_CARDS;
  const steps: number[] = [];
  while (limit !== Infinity) {
    limit = nextCardLimit(limit, 1000);
    steps.push(limit);
  }
  assert.ok(steps.length >= 2 && steps.length <= 10, `${steps.length} tandas`);
  assert.ok(steps.slice(0, -1).every((n, i, a) => n < 1000 && (i === 0 || n > a[i - 1]!)), JSON.stringify(steps));
  assert.equal(nextCardLimit(FIRST_PAINT_CARDS, 10), Infinity, "una columna corta pasa a «todas» a la primera");
});

test("el hueco mide lo que medirían las tarjetas sin pintar fuera de la vista (5 rem cada una y 0,5 rem entre ellas)", () => {
  assert.equal(cardsReserve(0), null);
  assert.equal(cardsReserve(-3), null);
  assert.equal(cardsReserve(1), "calc(1 * 5rem + 0 * 0.5rem)");
  assert.equal(cardsReserve(950), "calc(950 * 5rem + 949 * 0.5rem)");
});

test("vista Lista: el servidor pinta 100 filas en total y el resto llega por las mismas tandas", () => {
  assert.equal(FIRST_PAINT_ROWS, 100);
  let limit = FIRST_PAINT_ROWS;
  const steps: number[] = [];
  while (limit !== Infinity) steps.push((limit = nextCardLimit(limit, 1000)));
  assert.deepEqual(steps, [300, 500, 700, 900, Infinity]);
  assert.equal(nextCardLimit(FIRST_PAINT_ROWS, 120), Infinity, "una lista corta pasa a «todas» a la primera");
});

test("vista Lista: el hueco mide lo que las filas de una línea (tabla de escritorio y lista compacta del móvil)", () => {
  assert.equal(rowsReserve(0, false), null);
  assert.equal(rowsReserve(-1, true), null);
  assert.equal(rowsReserve(900, false), "calc(900 * 2.0625rem)");
  assert.equal(rowsReserve(900, true), "calc(900 * 3.765625rem)");
});
