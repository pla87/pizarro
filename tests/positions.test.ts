import assert from "node:assert/strict";
import { test } from "node:test";
import { needsRebalance, positionBetween, POSITION_STEP } from "../src/lib/positions";

test("posiciones entre vecinos", () => {
  assert.equal(positionBetween(null, null), POSITION_STEP);
  assert.equal(positionBetween(1000, null), 1000 + POSITION_STEP);
  assert.equal(positionBetween(null, 1000), 1000 - POSITION_STEP);
  assert.equal(positionBetween(1000, 2000), 1500);
});

test("detecta cuándo hay que renumerar", () => {
  assert.equal(needsRebalance(1, 2), false);
  assert.equal(needsRebalance(1, 1 + 1e-9), true);
  assert.equal(needsRebalance(null, 1), false);
});
