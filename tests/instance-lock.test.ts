// Aviso de otra copia de Pizarro usando la misma base de datos: reglas puras (src/lib/instance-lock-core.ts). Con
// PostgreSQL de verdad: tests/db/instance-lock.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INSTANCE_CONFLICT_GRACE_MS, INSTANCE_NOTICE_TTL_MS, nextLockStatus, otherInstanceNotice, parseStoredNotice, poolerInUrl, type InstanceLockStatus,
} from "../src/lib/instance-lock-core";

const OWN = "pizarro-instance:aaaa";
const OTHER = { appName: "pizarro-instance:bbbb", since: "2026-11-21T10:00:00.000Z" };

test("otra copia con el bloqueo: solo avisa si dura más del margen (los despliegues de Railway solapan unos segundos)", () => {
  const t0 = 1_000_000;
  let s: InstanceLockStatus = { status: "starting" };
  s = nextLockStatus(s, { kind: "busy", holder: OTHER }, t0, OWN);
  assert.deepEqual(s, { status: "waiting", since: t0, holderSince: OTHER.since });
  s = nextLockStatus(s, { kind: "busy", holder: OTHER }, t0 + INSTANCE_CONFLICT_GRACE_MS - 1, OWN);
  assert.equal(s.status, "waiting");
  s = nextLockStatus(s, { kind: "busy", holder: OTHER }, t0 + INSTANCE_CONFLICT_GRACE_MS, OWN);
  assert.deepEqual(s, { status: "conflict", since: t0, holderSince: OTHER.since });
  // La otra se para: el bloqueo pasa a esta copia.
  s = nextLockStatus(s, { kind: "acquired" }, t0 + INSTANCE_CONFLICT_GRACE_MS + 30_000, OWN);
  assert.deepEqual(s, { status: "held", since: t0 + INSTANCE_CONFLICT_GRACE_MS + 30_000 });
  // Mientras lo tiene, sigue igual (sin cambiar la fecha).
  assert.equal(nextLockStatus(s, { kind: "acquired" }, t0 + 10 * INSTANCE_CONFLICT_GRACE_MS, OWN), s);
  // Sin poder ver quién lo tiene (otro usuario de la base), cuenta como otra copia.
  assert.equal(nextLockStatus({ status: "starting" }, { kind: "busy", holder: null }, t0, OWN).status, "waiting");
  assert.equal(nextLockStatus({ status: "starting" }, { kind: "busy", holder: { appName: null, since: null } }, t0, OWN).status, "waiting");
});

test("PgBouncer en modo transacción: no hay avisos falsos", () => {
  // Lo tiene una sesión que no es de ninguna copia de Pizarro (una conexión del pooler que lo guardó) o la nuestra en otra conexión.
  assert.equal(nextLockStatus({ status: "starting" }, { kind: "busy", holder: { appName: "", since: null } }, 0, OWN).status, "pooler");
  assert.equal(nextLockStatus({ status: "starting" }, { kind: "busy", holder: { appName: "psql", since: null } }, 0, OWN).status, "pooler");
  assert.equal(nextLockStatus({ status: "waiting", since: 0, holderSince: null }, { kind: "busy", holder: { appName: OWN, since: null } }, 0, OWN).status, "pooler");
  // Lo teníamos y nuestra sesión ya no lo tiene: las consultas van por otra conexión del servidor.
  assert.equal(nextLockStatus({ status: "held", since: 0 }, { kind: "lost" }, 1, OWN).status, "pooler");
  // Y ya no se sale de ahí.
  assert.equal(nextLockStatus({ status: "pooler" }, { kind: "busy", holder: OTHER }, 10 * INSTANCE_CONFLICT_GRACE_MS, OWN).status, "pooler");
  assert.equal(poolerInUrl("postgresql://u:p@pooler.example.com:6543/db?pgbouncer=true"), true);
  assert.equal(poolerInUrl("postgresql://u:p@db.example.com:5432/db?sslmode=require"), false);
  assert.equal(poolerInUrl("no es una url"), false);
  // La base sin responder no es otra copia.
  assert.deepEqual(nextLockStatus({ status: "waiting", since: 0, holderSince: null }, { kind: "error", message: "ECONNREFUSED" }, 1, OWN), { status: "error", message: "ECONNREFUSED" });
});

test("aviso de Administración: el de este proceso o el que dejó la otra copia hace poco", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z");
  const conflict: InstanceLockStatus = { status: "conflict", since: now - 5 * 60_000, holderSince: null };
  assert.deepEqual(otherInstanceNotice(conflict, null, now), { since: "2026-11-21T11:55:00.000Z" });
  const stored = parseStoredNotice(JSON.stringify({ at: new Date(now - 30_000).toISOString(), since: "2026-11-21T11:00:00.000Z" }));
  assert.deepEqual(otherInstanceNotice({ status: "held", since: 0 }, stored, now), { since: "2026-11-21T11:00:00.000Z" });
  // Lo guardado caduca si nadie lo renueva (la otra copia ya se paró).
  assert.equal(otherInstanceNotice({ status: "held", since: 0 }, stored, now + INSTANCE_NOTICE_TTL_MS), null);
  assert.equal(otherInstanceNotice({ status: "pooler" }, stored, now), null);
  assert.equal(otherInstanceNotice({ status: "held", since: 0 }, null, now), null);
  assert.equal(parseStoredNotice("{roto"), null);
  assert.equal(parseStoredNotice(JSON.stringify({ at: "x", since: "y" })), null);
});
