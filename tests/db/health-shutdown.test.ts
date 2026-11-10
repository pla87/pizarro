// /api/health durante el apagado ordenado: 503 para que el balanceador deje de mandar tráfico a esta instancia.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import "./helpers";
import { GET as health } from "../../src/app/api/health/route";
import { resetShutdownForTests, runShutdown, type ShutdownDeps } from "../../src/lib/shutdown";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-health-"));
process.env.HEALTH_MIN_FREE_MB = "0";
after(() => resetShutdownForTests());

test("/api/health: 200 normalmente y 503 «shutting_down» en cuanto empieza el apagado", async () => {
  resetShutdownForTests();
  const ok = await health();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: "ok" });

  const deps: ShutdownDeps = {
    flushLogs: async () => {}, logEvent: () => {}, closeStreams: () => 0, exit: () => {}, graceMs: 50, flushMs: 50,
    stopListening: async () => ({ closed: 0, drained: async () => 0 }),
  };
  await runShutdown("SIGTERM", deps);
  const down = await health();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  assert.deepEqual(await down.json(), { status: "error", reason: "shutting_down" });
});
