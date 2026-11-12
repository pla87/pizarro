import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, test } from "node:test";
import { isShuttingDown, resetShutdownForTests, runShutdown, stopListening, trackInFlight, waitForInFlight, type ShutdownDeps } from "../src/lib/shutdown";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeDeps(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = [];
  const logs: { level?: string; message: string; details?: unknown }[] = [];
  const deps: ShutdownDeps = {
    flushLogs: async () => void calls.push("flush"),
    logEvent: (e) => (calls.push(`log:${e.action}`), void logs.push(e)),
    closeStreams: () => (calls.push("streams"), 2),
    stopListening: async () => (calls.push("listen"), { closed: 1, drained: async () => 0 }),
    exit: (code) => void calls.push(`exit:${code}`),
    graceMs: 300,
    flushMs: 300,
    ...overrides,
  };
  return { calls, deps, logs };
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

  test("espera a las peticiones en curso (después de cerrar los canales en vivo) y lo anota si no terminan", async () => {
    let finished = false;
    const a = fakeDeps({
      stopListening: async () => {
        a.calls.push("listen");
        return { closed: 1, drained: async () => (a.calls.push("drain"), await sleep(100), (finished = true), 0) };
      },
    });
    await runShutdown("SIGTERM", a.deps);
    assert.equal(finished, true);
    assert.deepEqual(a.calls, ["listen", "streams", "drain", "log:system.shutdown", "flush", "exit:143"]);
    assert.equal(a.logs[0]?.level, "info");

    resetShutdownForTests();
    const b = fakeDeps({ stopListening: async () => ({ closed: 1, drained: async (ms) => (await sleep(ms), 2) }), graceMs: 100 });
    await runShutdown("SIGTERM", b.deps);
    assert.equal(b.logs[0]?.level, "warn");
    assert.match(b.logs[0]!.message, /2 conexión\(es\) con peticiones sin terminar/);
    assert.equal((b.logs[0]!.details as { openConnections: number }).openConnections, 2);
  });
});

describe("stopListening con un servidor HTTP de verdad", () => {
  /** Servidor con keep-alive: /lento tarda `ms` en responder; el resto, al momento. */
  async function server(ms: number) {
    const srv = createServer((req, res) => {
      if (req.url === "/lento") setTimeout(() => res.end("hecho"), ms).unref();
      else res.end("ok");
    });
    srv.keepAliveTimeout = 60_000; // que una conexión libre no se cierre sola: la cierra el barrido
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    return { srv, port: (srv.address() as AddressInfo).port };
  }
  const get = (port: number, path: string, agent?: import("node:http").Agent) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      httpRequest({ host: "127.0.0.1", port, path, agent }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }).on("error", reject).end();
    });

  test("espera a que termine la petición en curso y cierra las conexiones libres sin esperar al keep-alive", async () => {
    const { srv, port } = await server(400);
    const { Agent } = await import("node:http");
    const agent = new Agent({ keepAlive: true });
    assert.equal((await get(port, "/", agent)).body, "ok"); // deja una conexión libre (keep-alive) abierta
    const slow = get(port, "/lento", agent);
    await sleep(50);
    const t0 = Date.now();
    const l = await stopListening();
    assert.equal(l.closed, 1);
    assert.equal(srv.listening, false);
    const open = await l.drained(5_000);
    const waited = Date.now() - t0;
    assert.equal(open, 0);
    assert.deepEqual(await slow, { status: 200, body: "hecho" });
    assert.ok(waited >= 300 && waited < 2_000, `esperó ${waited} ms`);
    agent.destroy();
  });

  test("sin peticiones en curso no espera; con una que no acaba, solo el plazo", async () => {
    const { port } = await server(60_000);
    const { Agent } = await import("node:http");
    const agent = new Agent({ keepAlive: true });
    await get(port, "/", agent);
    let t0 = Date.now();
    const idle = await stopListening();
    assert.equal(await idle.drained(5_000), 0);
    assert.ok(Date.now() - t0 < 500, `tardó ${Date.now() - t0} ms`);

    const other = await server(60_000);
    const hanging = get(other.port, "/lento", agent).catch(() => null);
    await sleep(50);
    t0 = Date.now();
    const busy = await stopListening();
    assert.equal(await busy.drained(200), 1);
    assert.ok(Date.now() - t0 < 1_000);
    agent.destroy();
    other.srv.closeAllConnections();
    await hanging;
  });
});

describe("apagado sin servidor HTTP encontrado", () => {
  function deps(closed: number) {
    const logs: { level?: string; action: string }[] = [];
    const d: ShutdownDeps = {
      flushLogs: async () => {}, logEvent: (e) => void logs.push(e), closeStreams: () => 0, exit: () => {}, graceMs: 20, flushMs: 20,
      stopListening: async () => ({ closed, drained: async () => 0 }),
    };
    return { d, logs };
  }
  async function run(nodeEnv: string, closed: number) {
    resetShutdownForTests();
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = nodeEnv;
    try {
      const x = deps(closed);
      await runShutdown("SIGTERM", x.d);
      return x.logs.filter((l) => l.action === "system.shutdown.no_listener");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
      resetShutdownForTests();
    }
  }

  test("en producción deja un aviso en el registro; con el servidor encontrado o fuera de producción, no", async () => {
    const warned = await run("production", 0);
    assert.equal(warned.length, 1);
    assert.equal(warned[0]!.level, "warn");
    assert.equal((await run("production", 1)).length, 0);
    assert.equal((await run("test", 0)).length, 0);
  });
});
