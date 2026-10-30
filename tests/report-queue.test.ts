import assert from "node:assert/strict";
import { describe, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { queuedRender, PdfTimeoutError } = await import("../src/lib/report-build");

describe("cola de renders PDF", () => {
  test("los renders se ejecutan de uno en uno y en orden", async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => () => new Promise<string>((r) => { log.push(`start ${name}`); setTimeout(() => { log.push(`end ${name}`); r(name); }, ms); });
    const out = await Promise.all([queuedRender(job("a", 30)), queuedRender(job("b", 5))]);
    assert.deepEqual(out, ["a", "b"]);
    assert.deepEqual(log, ["start a", "end a", "start b", "end b"]);
  });

  test("un render atascado da error claro a los 'timeoutMs' y no bloquea el siguiente", async () => {
    const stuck = queuedRender(() => new Promise<string>(() => {}), 40);
    const next = queuedRender(async () => "ok", 1000);
    await assert.rejects(stuck, (err: Error) => err instanceof PdfTimeoutError && err.message === "El PDF tardó demasiado; inténtalo de nuevo" && (err as InstanceType<typeof PdfTimeoutError>).status === 504);
    assert.equal(await next, "ok");
  });

  test("un render que falla no bloquea la cola", async () => {
    await assert.rejects(queuedRender(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await queuedRender(async () => 7), 7);
  });
});
