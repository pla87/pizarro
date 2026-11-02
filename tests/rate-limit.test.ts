import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimit, rateLimitRetryAfterSec, resetRateLimit } from "../src/lib/rate-limit";

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

test("rateLimitRetryAfterSec: segundos hasta el reinicio de la ventana", () => {
  const key = "test:retry";
  resetRateLimit(key);
  assert.equal(rateLimitRetryAfterSec(key), 1);
  rateLimit(key, 1, 30_000);
  const s = rateLimitRetryAfterSec(key);
  assert.ok(s >= 29 && s <= 30);
  resetRateLimit(key);
});
