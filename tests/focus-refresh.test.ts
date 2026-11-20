import assert from "node:assert/strict";
import { test } from "node:test";
import { channelStalled, FOCUS_REFRESH_GAP_MS, FOCUS_REFRESH_LIVE_MS, FOCUS_REFRESH_MIN_MS, LIVE_HEALTHY_MS, shouldRefreshOnFocus } from "../src/lib/focus-refresh";

test("sin canal en vivo: como mucho una vez por minuto", () => {
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: 5_000, channelOpen: false, channelGap: false }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_MIN_MS - 1, channelOpen: false, channelGap: false }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_MIN_MS, channelOpen: false, channelGap: false }), true);
});

test("canal en vivo sano: se espacia más (5 minutos)", () => {
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_MIN_MS * 2, channelOpen: true, channelGap: false }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_LIVE_MS - 1, channelOpen: true, channelGap: false }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_LIVE_MS, channelOpen: true, channelGap: false }), true);
});

test("canal que estuvo desconectado: se refresca al volver (con una pausa mínima)", () => {
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_GAP_MS - 1, channelOpen: true, channelGap: true }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_GAP_MS, channelOpen: true, channelGap: true }), true);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_GAP_MS, channelOpen: false, channelGap: true }), true);
});

test("recarga de respaldo: cada 15 minutos con el canal sano, cada 2 sin él", async () => {
  const { BACKUP_REFRESH_LIVE_MS, BACKUP_REFRESH_MS, LIVE_HEALTHY_MS, backupRefreshDue, channelHealthy } = await import("../src/lib/focus-refresh");
  assert.equal(channelHealthy({ open: true, sinceMessageMs: 1_000 }), true);
  assert.equal(channelHealthy({ open: true, sinceMessageMs: LIVE_HEALTHY_MS }), false, "abierto pero mudo");
  assert.equal(channelHealthy({ open: false, sinceMessageMs: 1_000 }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_MS, healthy: true }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_LIVE_MS - 1, healthy: true }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_LIVE_MS, healthy: true }), true);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_MS - 1, healthy: false }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_MS, healthy: false }), true);
});

test("canal abierto pero mudo (sin ping en el tiempo de «sano»): se da por caído para reabrirlo", () => {
  assert.equal(channelStalled({ open: true, sinceMessageMs: 1000 }), false);
  assert.equal(channelStalled({ open: true, sinceMessageMs: LIVE_HEALTHY_MS }), true);
  assert.equal(channelStalled({ open: false, sinceMessageMs: LIVE_HEALTHY_MS * 10 }), false, "cerrado ya lo trata el error del canal");
});
