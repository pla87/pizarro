// Aviso de otra copia de Pizarro usando la misma base de datos (src/lib/instance-lock.ts) con PostgreSQL de verdad: dos
// «copias» (dos monitores con su conexión) se disputan el bloqueo consultivo; la segunda solo avisa pasado el margen y lo
// coge cuando la primera se para. Una sesión ajena con el bloqueo (como la de un pooler) no provoca un aviso falso.
import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { LOCK_INSTANCE } from "../../src/lib/advisory-locks";
import { INSTANCE_NOTICE_KEY, parseStoredNotice, type InstanceLockStatus } from "../../src/lib/instance-lock-core";
import { InstanceLockMonitor } from "../../src/lib/instance-lock";
import { db } from "./helpers";

const url = process.env.DATABASE_URL!;

test("dos copias con la misma base: la segunda espera, avisa pasado el margen y coge el bloqueo cuando la primera se para", async () => {
  let now = 1_000_000;
  const changes: string[] = [];
  const a = new InstanceLockMonitor({ url, appName: "pizarro-instance:prueba-a", now: () => now, graceMs: 120_000 });
  const b = new InstanceLockMonitor({
    url, appName: "pizarro-instance:prueba-b", now: () => now, graceMs: 120_000,
    onChange: (prev: InstanceLockStatus, next: InstanceLockStatus) => changes.push(`${prev.status}>${next.status}`),
    onConflict: async (s) => {
      const value = JSON.stringify({ at: new Date(now).toISOString(), since: new Date(s.since).toISOString() });
      await db.appState.upsert({ where: { key: INSTANCE_NOTICE_KEY }, create: { key: INSTANCE_NOTICE_KEY, value }, update: { value } });
    },
  });
  try {
    assert.equal((await a.tick()).status, "held");
    const first = await b.tick();
    assert.equal(first.status, "waiting");
    // Desde cuándo está conectada la otra copia (backend_start de su sesión).
    assert.ok(first.status === "waiting" && first.holderSince && Date.parse(first.holderSince) > 0);
    now += 60_000;
    assert.equal((await b.tick()).status, "waiting", "dentro del margen: sin aviso");
    assert.equal(await db.appState.findUnique({ where: { key: INSTANCE_NOTICE_KEY } }), null);
    now += 60_000;
    assert.equal((await b.tick()).status, "conflict");
    // La copia que avisa lo deja guardado para que la otra (la que tiene el bloqueo) también lo muestre.
    const stored = parseStoredNotice((await db.appState.findUnique({ where: { key: INSTANCE_NOTICE_KEY } }))?.value);
    assert.equal(stored?.since, new Date(1_000_000).toISOString());
    // La primera sigue teniéndolo en su sesión.
    assert.equal((await a.tick()).status, "held");
    await a.stop();
    now += 30_000;
    assert.equal((await b.tick()).status, "held");
    assert.deepEqual(changes, ["starting>waiting", "waiting>conflict", "conflict>held"]);
    // Tenerlo no cambia en las siguientes comprobaciones (misma sesión, con el bloqueo).
    assert.equal((await b.tick()).status, "held");
  } finally {
    await a.stop();
    await b.stop();
    await db.appState.deleteMany({ where: { key: INSTANCE_NOTICE_KEY } });
  }
});

test("una sesión que no es de ninguna copia de Pizarro con el bloqueo (p. ej. de un pooler): no avisa", async () => {
  const other = new pg.Client({ connectionString: url, application_name: "pgbouncer-servidor" });
  await other.connect();
  const m = new InstanceLockMonitor({ url, appName: "pizarro-instance:prueba-c", graceMs: 0 });
  try {
    await other.query("SELECT pg_advisory_lock($1)", [LOCK_INSTANCE]);
    assert.equal((await m.tick()).status, "pooler");
    // Y deja de comprobar (sin conexión abierta).
    assert.equal((await m.tick()).status, "pooler");
  } finally {
    await m.stop();
    await other.end();
  }
});

test("si la conexión se pierde, no avisa y vuelve a coger el bloqueo en la siguiente comprobación", async () => {
  const m = new InstanceLockMonitor({ url, appName: "pizarro-instance:prueba-d" });
  try {
    assert.equal((await m.tick()).status, "held");
    // Se corta la sesión desde fuera (como un reinicio de PostgreSQL o un corte de red).
    await db.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'pizarro-instance:prueba-d'");
    assert.equal((await m.tick()).status, "error");
    assert.equal((await m.tick()).status, "held");
  } finally {
    await m.stop();
  }
});
