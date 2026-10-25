// Tareas de fondo: bloqueo de Postgres (un proceso a la vez) y última ejecución persistente en JobRun.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db } from "./helpers";
import { runJob, withAdvisoryLock, listJobRuns } from "../../src/lib/jobs";

const KEY = 990_001;

describe("bloqueo del mantenimiento", () => {
  test("mientras uno lo tiene, otro no entra; al soltarlo, sí", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const first = withAdvisoryLock(KEY, async () => {
      entered();
      await held;
      return "primero";
    });
    await inside;
    // Otra conexión (como otro proceso) no consigue el bloqueo y no espera.
    let ran = false;
    const second = await withAdvisoryLock(KEY, async () => (ran = true));
    assert.deepEqual(second, { ran: false });
    assert.equal(ran, false);
    release();
    assert.deepEqual(await first, { ran: true, value: "primero" });
    assert.deepEqual(await withAdvisoryLock(KEY, async () => 2), { ran: true, value: 2 });
  });

  test("si la tarea falla, el error sale y el bloqueo queda libre", async () => {
    await assert.rejects(withAdvisoryLock(KEY, async () => { throw new Error("boom"); }), /boom/);
    assert.deepEqual(await withAdvisoryLock(KEY, async () => "ok"), { ran: true, value: "ok" });
  });

  test("dos pasadas a la vez: la tarea se ejecuta una sola vez", async () => {
    let count = 0;
    const pass = () => withAdvisoryLock(KEY, () => runJob({ name: "test-once", run: async () => { count++; await new Promise((r) => setTimeout(r, 200)); } }));
    const results = await Promise.all([pass(), pass(), pass()]);
    assert.equal(results.filter((r) => r.ran).length, 1);
    assert.equal(count, 1);
  });
});

describe("JobRun", () => {
  test("anota inicio, fin y resultado", async () => {
    assert.equal(await runJob({ name: "test-ok", run: async () => 1 }), "ok");
    const row = await db.jobRun.findUniqueOrThrow({ where: { name: "test-ok" } });
    assert.ok(row.lastStartedAt && row.lastFinishedAt && row.lastFinishedAt >= row.lastStartedAt);
    assert.equal(row.lastOk, true);
    assert.equal(row.lastError, null);
  });

  test("un error queda anotado (recortado) y no se propaga; la siguiente vez correcta lo limpia", async () => {
    assert.equal(await runJob({ name: "test-err", run: async () => { throw new Error("x".repeat(2000)); } }), "error");
    let row = await db.jobRun.findUniqueOrThrow({ where: { name: "test-err" } });
    assert.equal(row.lastOk, false);
    assert.equal(row.lastError?.length, 500);
    assert.equal(await runJob({ name: "test-err", run: async () => {} }), "ok");
    row = await db.jobRun.findUniqueOrThrow({ where: { name: "test-err" } });
    assert.equal(row.lastOk, true);
    assert.equal(row.lastError, null);
  });

  test("everyMs: no se repite antes de tiempo, aunque sea otro proceso o tras reiniciar", async () => {
    let count = 0;
    const job = { name: "test-daily", run: async () => void count++, everyMs: 23 * 3_600_000 };
    const t0 = new Date("2026-10-25T08:00:00Z");
    assert.equal(await runJob(job, t0), "ok");
    assert.equal(await runJob(job, new Date(t0.getTime() + 3_600_000)), "skipped");
    assert.equal(await runJob(job, new Date(t0.getTime() + 23 * 3_600_000)), "ok");
    assert.equal(count, 2);
  });

  test("listJobRuns devuelve fechas en ISO", async () => {
    const runs = await listJobRuns();
    const ok = runs.find((r) => r.name === "test-ok");
    assert.ok(ok && typeof ok.lastStartedAt === "string" && ok.lastOk === true);
  });
});
