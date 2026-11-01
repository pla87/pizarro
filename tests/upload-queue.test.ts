import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planUploads, QueueStopped, retryDelayMs, runQueue, summarizeSkipped, withRetry } from "../src/lib/upload-queue";

const file = (name: string, size: number) => ({ name, size }) as File;

describe("planUploads", () => {
  test("acepta más de 10 archivos y omite los que no caben con su motivo", () => {
    const files = Array.from({ length: 35 }, (_, i) => file(`f${i}.zip`, 1000));
    files.push(file("grande.zip", 50_000), file("vacio.txt", 0));
    const { accepted, skipped } = planUploads(files, { fileMaxBytes: 10_000, remainingBytes: 30_000 });
    assert.equal(accepted.length, 30);
    assert.deepEqual(skipped.filter((s) => s.reason === "too_big").map((s) => s.name), ["grande.zip"]);
    assert.deepEqual(skipped.filter((s) => s.reason === "empty").map((s) => s.name), ["vacio.txt"]);
    assert.equal(skipped.filter((s) => s.reason === "total").length, 5);
  });
  test("un archivo que no cabe en la suma no impide que entren los pequeños siguientes", () => {
    const { accepted, skipped } = planUploads([file("a", 600), file("b", 600), file("c", 300)], { fileMaxBytes: 1000, remainingBytes: 1000 });
    assert.deepEqual(accepted.map((f) => f.name), ["a", "c"]);
    assert.deepEqual(skipped.map((s) => s.name), ["b"]);
  });
});

describe("runQueue", () => {
  test("nunca supera la concurrencia y conserva el orden de resultados", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    const res = await runQueue(items, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      active--;
      return n * 2;
    }, { concurrency: 3 });
    assert.equal(peak, 3);
    assert.deepEqual(res.map((r) => (r.status === "fulfilled" ? r.value : -1)), items.map((n) => n * 2));
  });
  test("un fallo no detiene al resto y notifica el progreso", async () => {
    const settled: number[] = [];
    const res = await runQueue([1, 2, 3, 4], async (n) => {
      if (n === 2) throw new Error("x");
      return n;
    }, { concurrency: 2, onSettle: (i) => settled.push(i) });
    assert.deepEqual(res.map((r) => r.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    assert.equal(settled.length, 4);
  });
  test("stopWhen deja sin empezar los elementos que faltan", async () => {
    const res = await runQueue([1, 2, 3, 4, 5], async (n) => {
      if (n === 1) throw new Error("total");
      return n;
    }, { concurrency: 1, stopWhen: () => true });
    assert.ok(res.slice(1).every((r) => r.status === "rejected" && r.reason instanceof QueueStopped));
  });
  test("lista vacía", async () => {
    assert.deepEqual(await runQueue([], async () => 1), []);
  });
});

describe("withRetry", () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  test("reintenta 429/503 con espera creciente y acaba bien", async () => {
    waits.length = 0;
    let calls = 0;
    const out = await withRetry(async () => {
      if (++calls < 3) throw Object.assign(new Error("busy"), { status: calls === 1 ? 429 : 503 });
      return "ok";
    }, { sleep });
    assert.equal(out, "ok");
    assert.deepEqual(waits, [2000, 4000]);
  });
  test("respeta Retry-After y se rinde tras los reintentos", async () => {
    waits.length = 0;
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw Object.assign(new Error("busy"), { status: 429, retryAfterSec: 5 });
    }, { sleep, retries: 2 }));
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5000, 5000]);
  });
  test("no reintenta otros errores", async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw Object.assign(new Error("grande"), { status: 413 });
    }, { sleep }));
    assert.equal(calls, 1);
  });
  test("retryDelayMs tiene tope", () => {
    assert.equal(retryDelayMs(10), 30_000);
  });
});

test("summarizeSkipped acorta la lista", () => {
  const s = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, size: 1, reason: "total" as const }));
  assert.equal(summarizeSkipped(s, (x) => x.name, 3), "f0, f1, f2 … +5");
});
