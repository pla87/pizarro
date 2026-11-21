// Columnas largas del tablero (src/components/board/deferredCards.ts): el servidor pinta solo las primeras tarjetas de
// cada columna, el resto llega por tandas después de hidratar y, mientras tanto, un hueco ocupa lo mismo que ellas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsReserve, FIRST_PAINT_CARDS, nextCardLimit } from "../src/components/board/deferredCards";

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
