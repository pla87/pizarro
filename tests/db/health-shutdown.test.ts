// /api/health durante el apagado ordenado: 503 para que el balanceador deje de mandar tráfico a esta instancia.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import "./helpers";
import { GET as health } from "../../src/app/api/health/route";
import { invalidateMemo } from "../../src/lib/memo";
import { resetShutdownForTests, runShutdown, type ShutdownDeps } from "../../src/lib/shutdown";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-health-"));
process.env.HEALTH_MIN_FREE_MB = "0";
after(() => resetShutdownForTests());

const HEALTH_KEY = "health:check";
const deps: ShutdownDeps = {
  flushLogs: async () => {}, logEvent: () => {}, closeStreams: () => 0, exit: () => {}, graceMs: 50, flushMs: 50,
  stopListening: async () => ({ closed: 0, drained: async () => 0 }),
};

test("/api/health: 200 normalmente y 503 «shutting_down» en cuanto empieza el apagado", async () => {
  resetShutdownForTests();
  invalidateMemo(HEALTH_KEY);
  const ok = await health();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: "ok" });

  await runShutdown("SIGTERM", deps);
  const down = await health();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  assert.deepEqual(await down.json(), { status: "error", reason: "shutting_down" });
});

test("/api/health: con el disco casi lleno, 200 con el aviso (no 503: Railway no desplegaba)", async () => {
  resetShutdownForTests();
  invalidateMemo(HEALTH_KEY);
  process.env.HEALTH_MIN_FREE_MB = String(1024 ** 3);
  try {
    const res = await health();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", warnings: ["low_disk_space"] });
  } finally {
    process.env.HEALTH_MIN_FREE_MB = "0";
    invalidateMemo(HEALTH_KEY);
  }
});

test("/api/health: guarda el resultado unos segundos y el apagado no lo usa", async () => {
  resetShutdownForTests();
  invalidateMemo(HEALTH_KEY);
  const dir = process.env.UPLOAD_DIR;
  try {
    const first = await Promise.all([health(), health(), health()]);
    assert.deepEqual(first.map((r) => r.status), [200, 200, 200]);
    // La carpeta deja de valer: mientras dura lo guardado sigue diciendo 200 (no vuelve a comprobar en cada petición).
    process.env.UPLOAD_DIR = "/dev/null/uploads";
    assert.equal((await health()).status, 200);
    // Al caducar (aquí, olvidándolo) se comprueba de nuevo.
    invalidateMemo(HEALTH_KEY);
    const bad = await health();
    assert.equal(bad.status, 503);
    assert.deepEqual(await bad.json(), { status: "error", reason: "uploads_not_writable" });
    process.env.UPLOAD_DIR = dir;
    invalidateMemo(HEALTH_KEY);
    assert.equal((await health()).status, 200);
    // Con un 200 guardado, el apagado responde 503 al instante.
    await runShutdown("SIGTERM", deps);
    const down = await health();
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { status: "error", reason: "shutting_down" });
  } finally {
    process.env.UPLOAD_DIR = dir;
    invalidateMemo(HEALTH_KEY);
    resetShutdownForTests();
  }
});
