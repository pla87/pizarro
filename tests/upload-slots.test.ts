import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { acquireUploadSlot, declaredLength, MAX_UPLOADS_AT_ONCE } from "../src/lib/upload-slots";

describe("acquireUploadSlot", () => {
  test("concede como mucho MAX_UPLOADS_AT_ONCE a la vez; las demás esperan su turno o se rinden", async () => {
    const held = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot()));
    assert.ok(held.every((r) => typeof r === "function"));
    assert.equal(await acquireUploadSlot(20), null); // sin hueco a tiempo
    const waiting = acquireUploadSlot(1000);
    held[0]!();
    held[0]!(); // doble liberación: no libera dos huecos
    const next = await waiting; // recibe el hueco liberado
    assert.ok(next);
    assert.equal(await acquireUploadSlot(20), null);
    next();
    for (const r of held.slice(1)) r!();
    const free = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot(20)));
    assert.ok(free.every(Boolean));
    for (const r of free) r!();
  });
});

describe("declaredLength", () => {
  test("solo acepta un entero válido", () => {
    assert.equal(declaredLength(new Headers()), null);
    assert.equal(declaredLength(new Headers({ "content-length": "abc" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "-5" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "1234" })), 1234);
    assert.equal(declaredLength(new Headers({ "content-length": "0" })), 0);
  });
});
