import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimit, resetRateLimit } from "../src/lib/rate-limit";

test("rateLimit: el coste suma al contador (creaciones múltiples)", () => {
  const key = "test:cost";
  resetRateLimit(key);
  assert.equal(rateLimit(key, 10, 60_000, 6), true);
  assert.equal(rateLimit(key, 10, 60_000, 4), true);
  assert.equal(rateLimit(key, 10, 60_000), false);
  resetRateLimit(key);
  // Un solo golpe mayor que el límite se rechaza ya en la primera llamada.
  assert.equal(rateLimit(key, 10, 60_000, 11), false);
  resetRateLimit(key);
});
