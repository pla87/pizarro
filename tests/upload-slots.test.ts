import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { acquireUploadSlot, declaredLength, MAX_UPLOADS_AT_ONCE } from "../src/lib/upload-slots";

describe("acquireUploadSlot", () => {
  test("concede como mucho MAX_UPLOADS_AT_ONCE a la vez y libera una sola vez", () => {
    const held = Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot());
    assert.ok(held.every((r) => typeof r === "function"));
    assert.equal(acquireUploadSlot(), null);
    held[0]!();
    held[0]!(); // doble liberación: no libera dos huecos
    const again = acquireUploadSlot();
    assert.ok(again);
    assert.equal(acquireUploadSlot(), null);
    again();
    for (const r of held.slice(1)) r!();
    const free = Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot());
    assert.ok(free.every(Boolean));
    for (const r of free) r!();
  });
});

describe("declaredLength", () => {
  test("exige un entero válido", () => {
    assert.equal(declaredLength(new Headers()), null);
    assert.equal(declaredLength(new Headers({ "content-length": "abc" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "-5" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "1234" })), 1234);
    assert.equal(declaredLength(new Headers({ "content-length": "0" })), 0);
  });
});
