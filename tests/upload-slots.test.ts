import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { acquireUploadSlot, declaredLength, MAX_UPLOADS_AT_ONCE, readBodyLimited, UploadTooSlowError } from "../src/lib/upload-slots";

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

describe("readBodyLimited: subidas lentas", () => {
  const enc = new TextEncoder();
  const dripReq = (chunks: number, everyMs: number) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent >= chunks) return c.close();
        await new Promise((r) => setTimeout(r, everyMs));
        sent++;
        c.enqueue(enc.encode("x"));
      },
    });
    return new Request("http://localhost/x", { method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=zz" } } as RequestInit);
  };

  test("una subida que va a pocos bytes por segundo se corta y libera el hueco", async () => {
    const release = await acquireUploadSlot();
    assert.ok(release);
    const t0 = Date.now();
    try {
      await assert.rejects(
        readBodyLimited(dripReq(1000, 20), 10_000_000, "formData", { windowMs: 100, minBytesPerSec: 1000 }),
        UploadTooSlowError,
      );
    } finally {
      release();
    }
    assert.ok(Date.now() - t0 < 2000);
    const again = await Promise.all(Array.from({ length: MAX_UPLOADS_AT_ONCE }, () => acquireUploadSlot(20)));
    assert.ok(again.every(Boolean));
    for (const r of again) r!();
  });

  test("el tiempo máximo total también corta", async () => {
    await assert.rejects(readBodyLimited(dripReq(1000, 20), 10_000_000, "text", { windowMs: 60_000, totalMs: 150 }), UploadTooSlowError);
  });

  test("una subida normal pasa", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(500_000)], "a.bin"));
    const req = new Request("http://localhost/x", { method: "POST", body: fd });
    const out = await readBodyLimited(req, 10_000_000, "formData", { windowMs: 100, minBytesPerSec: 1000 });
    assert.equal((out.get("file") as File).size, 500_000);
  });
});
