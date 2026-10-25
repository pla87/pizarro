import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_STALE_MS, backupAlertFor, backupAlertMailDue } from "../src/lib/backup-alert-core";

const now = Date.parse("2026-10-30T12:00:00Z");
const h = (n: number) => n * 3600_000;

test("aviso de copia: reciente no avisa; pasadas 48 h sí", () => {
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: now - h(2), now }).active, false);
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: now - BACKUP_STALE_MS, now }).active, false);
  const stale = backupAlertFor({ keyOk: true, lastOkAt: now - h(49), now });
  assert.deepEqual([stale.active, stale.reason, stale.lastAt], [true, "stale", new Date(now - h(49)).toISOString()]);
});

test("aviso de copia: con clave y ninguna copia avisa; sin clave nunca", () => {
  assert.deepEqual(backupAlertFor({ keyOk: true, lastOkAt: null, now }), { active: true, reason: "none", lastAt: null });
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: Number.NaN, now }).reason, "none");
  assert.equal(backupAlertFor({ keyOk: false, lastOkAt: null, now }).active, false);
  assert.equal(backupAlertFor({ keyOk: false, lastOkAt: now - h(500), now }).active, false);
});

test("aviso de copia externa: solo si hay destino configurado y tras 48 h sin subida correcta", () => {
  const local = now - h(2);
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: local, now, external: { configured: false, lastOkAt: null } }).active, false);
  assert.deepEqual(backupAlertFor({ keyOk: true, lastOkAt: local, now, external: { configured: true, lastOkAt: null } }), { active: true, reason: "externalNone", lastAt: null });
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: local, now, external: { configured: true, lastOkAt: now - h(30) } }).active, false);
  const stale = backupAlertFor({ keyOk: true, lastOkAt: local, now, external: { configured: true, lastOkAt: now - h(50) } });
  assert.deepEqual([stale.reason, stale.lastAt], ["externalStale", new Date(now - h(50)).toISOString()]);
  // La copia local atrasada tiene prioridad.
  assert.equal(backupAlertFor({ keyOk: true, lastOkAt: now - h(60), now, external: { configured: true, lastOkAt: null } }).reason, "stale");
  assert.equal(backupAlertFor({ keyOk: false, lastOkAt: null, now, external: { configured: true, lastOkAt: null } }).active, false);
});

test("email de aviso: como mucho cada 24 h", () => {
  assert.equal(backupAlertMailDue(null, now), true);
  assert.equal(backupAlertMailDue(now - h(23), now), false);
  assert.equal(backupAlertMailDue(now - h(24), now), true);
  assert.equal(backupAlertMailDue(Number.NaN, now), true);
});
