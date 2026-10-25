import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkUploads, DEFAULT_MIN_FREE_MB, evaluateHealth, minFreeBytes } from "../src/lib/health";
import { shouldExitOnUncaught } from "../src/lib/process-errors";
import { appTimeZone, formatDate } from "../src/lib/format";

const MB = 1024 * 1024;
const okUploads = { writable: true, freeBytes: 10_000 * MB };

test("salud: todo bien → ok", () => {
  assert.deepEqual(evaluateHealth({ dbOk: true, uploads: okUploads, minFreeBytes: 200 * MB }), { ok: true });
});

test("salud: motivos en orden de gravedad", () => {
  assert.deepEqual(evaluateHealth({ dbOk: false, uploads: { writable: false, freeBytes: 0 }, minFreeBytes: 200 * MB }), { ok: false, reason: "database" });
  assert.deepEqual(evaluateHealth({ dbOk: true, uploads: { writable: false, freeBytes: 0 }, minFreeBytes: 200 * MB }), { ok: false, reason: "uploads_not_writable" });
  assert.deepEqual(evaluateHealth({ dbOk: true, uploads: { writable: true, freeBytes: 199 * MB }, minFreeBytes: 200 * MB }), { ok: false, reason: "low_disk_space" });
});

test("salud: espacio desconocido o comprobación desactivada no fallan", () => {
  assert.deepEqual(evaluateHealth({ dbOk: true, uploads: { writable: true, freeBytes: null }, minFreeBytes: 200 * MB }), { ok: true });
  assert.deepEqual(evaluateHealth({ dbOk: true, uploads: { writable: true, freeBytes: 0 }, minFreeBytes: 0 }), { ok: true });
});

test("HEALTH_MIN_FREE_MB: por defecto 200, 0 desactiva, valores raros → por defecto", () => {
  assert.equal(minFreeBytes({}), DEFAULT_MIN_FREE_MB * MB);
  assert.equal(minFreeBytes({ HEALTH_MIN_FREE_MB: "" }), DEFAULT_MIN_FREE_MB * MB);
  assert.equal(minFreeBytes({ HEALTH_MIN_FREE_MB: "1024" }), 1024 * MB);
  assert.equal(minFreeBytes({ HEALTH_MIN_FREE_MB: "0" }), 0);
  assert.equal(minFreeBytes({ HEALTH_MIN_FREE_MB: "-5" }), DEFAULT_MIN_FREE_MB * MB);
  assert.equal(minFreeBytes({ HEALTH_MIN_FREE_MB: "mucho" }), DEFAULT_MIN_FREE_MB * MB);
});

test("checkUploads: carpeta escribible con espacio, y la crea si no existe", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-health-"));
  try {
    const r = await checkUploads(dir);
    assert.equal(r.writable, true);
    assert.ok(r.freeBytes !== null && r.freeBytes > 0);
    const missing = path.join(dir, "a", "b");
    assert.equal((await checkUploads(missing)).writable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkUploads: ruta imposible → no escribible", async () => {
  // Un fichero ocupa el sitio de una carpeta intermedia: no se puede crear.
  const r = await checkUploads("/dev/null/uploads");
  assert.equal(r.writable, false);
});

test("excepción no capturada: solo se sale en producción y con EXIT_ON_UNCAUGHT_EXCEPTION=1", () => {
  assert.equal(shouldExitOnUncaught({ NODE_ENV: "production" }), false);
  assert.equal(shouldExitOnUncaught({ NODE_ENV: "production", EXIT_ON_UNCAUGHT_EXCEPTION: "1" }), true);
  assert.equal(shouldExitOnUncaught({ NODE_ENV: "production", EXIT_ON_UNCAUGHT_EXCEPTION: "0" }), false);
  assert.equal(shouldExitOnUncaught({ NODE_ENV: "development" }), false);
});

test("zona horaria: en el servidor sale de APP_TIMEZONE en tiempo de ejecución", () => {
  const prev = process.env.APP_TIMEZONE;
  try {
    delete process.env.APP_TIMEZONE;
    assert.equal(appTimeZone(), "Europe/Madrid");
    process.env.APP_TIMEZONE = "America/Mexico_City";
    assert.equal(appTimeZone(), "America/Mexico_City");
    assert.equal(formatDate("2026-10-25T12:00:00Z", "timeHm"), "06:00");
  } finally {
    if (prev === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = prev;
  }
});

test("zona horaria: en el navegador sale de data-tz del <html>", () => {
  const g = globalThis as unknown as { document?: unknown };
  g.document = { documentElement: { dataset: { tz: "Asia/Tokyo" } } };
  try {
    assert.equal(appTimeZone(), "Asia/Tokyo");
    assert.equal(formatDate("2026-10-25T12:00:00Z", "timeHm"), "21:00");
    g.document = { documentElement: { dataset: {} } };
    assert.equal(appTimeZone(), "Europe/Madrid");
  } finally {
    delete g.document;
  }
});
