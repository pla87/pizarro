import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { isShuttingDown, resetShutdownForTests, runShutdown, trackInFlight, waitForInFlight, type ShutdownDeps } from "../src/lib/shutdown";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeDeps(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = [];
  const deps: ShutdownDeps = {
    flushLogs: async () => void calls.push("flush"),
    logEvent: (e) => void calls.push(`log:${e.action}`),
    closeStreams: () => (calls.push("streams"), 2),
    stopListening: async () => (calls.push("listen"), 1),
    exit: (code) => void calls.push(`exit:${code}`),
    graceMs: 300,
    flushMs: 300,
    ...overrides,
  };
  return { calls, deps };
}

describe("apagado ordenado", () => {
  beforeEach(() => resetShutdownForTests());

  test("sin trabajo pendiente: corta la entrada, guarda los registros y sale con 143 (SIGTERM) o 130 (SIGINT)", async () => {
    const a = fakeDeps();
    await runShutdown("SIGTERM", a.deps);
    assert.deepEqual(a.calls, ["listen", "streams", "log:system.shutdown", "flush", "exit:143"]);
    assert.equal(isShuttingDown(), true);
    resetShutdownForTests();
    const b = fakeDeps();
    await runShutdown("SIGINT", b.deps);
    assert.equal(b.calls.at(-1), "exit:130");
  });

  test("espera a los envíos en curso antes de guardar los registros", async () => {
    let sent = false;
    trackInFlight(() => sleep(100).then(() => (sent = true)));
    const a = fakeDeps();
    await runShutdown("SIGTERM", a.deps);
    assert.equal(sent, true);
    assert.deepEqual(a.calls, ["listen", "streams", "log:system.shutdown", "flush", "exit:143"]);
  });

  test("un envío que no termina no retiene el apagado más que el margen", async () => {
    trackInFlight(() => new Promise<void>(() => {}));
    const t0 = Date.now();
    const a = fakeDeps({ graceMs: 150 });
    await runShutdown("SIGTERM", a.deps);
    assert.ok(Date.now() - t0 < 1000, "tarda solo el margen");
    assert.equal(a.calls.at(-2), "flush");
    assert.equal(a.calls.at(-1), "exit:143");
  });

  test("si guardar los registros se cuelga, sale igualmente tras el tope", async () => {
    const a = fakeDeps({ flushLogs: () => new Promise<void>(() => {}), flushMs: 100 });
    const t0 = Date.now();
    await runShutdown("SIGTERM", a.deps);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(a.calls.at(-1), "exit:143");
  });

  test("una segunda señal sale de inmediato", async () => {
    const a = fakeDeps({ flushLogs: () => new Promise<void>(() => {}), flushMs: 300 });
    void runShutdown("SIGINT", a.deps);
    await sleep(20);
    const b = fakeDeps();
    await runShutdown("SIGINT", b.deps);
    assert.deepEqual(b.calls, ["exit:130"]);
  });

  test("trackInFlight: un trabajo dentro de otro anotado cuenta una sola vez", async () => {
    let seen = -1;
    const outer = trackInFlight(async () => {
      const inner = trackInFlight(() => sleep(50));
      await sleep(5);
      seen = await waitForInFlight(1); // el externo sigue en curso: 1, no 2
      await inner;
    });
    await outer;
    assert.equal(seen, 1);
  });

  test("trackInFlight: un fallo tampoco bloquea la espera", async () => {
    const failing = trackInFlight(() => Promise.reject(new Error("smtp")));
    await assert.rejects(failing, /smtp/);
    assert.equal(await waitForInFlight(100), 0);
  });
});
