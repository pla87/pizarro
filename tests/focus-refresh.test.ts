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

test("canal sano y al día según su ping: solo la recarga de seguridad, cada hora", async () => {
  const { BACKUP_REFRESH_LIVE_MS, BACKUP_REFRESH_MS, LIVE_CHECKED_REFRESH_MS, backupRefreshDue, cursorChecked } = await import("../src/lib/focus-refresh");
  assert.equal(LIVE_CHECKED_REFRESH_MS, 60 * 60_000);
  // Recarga periódica: sin la de 15 minutos, pero sí la de cada hora.
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_LIVE_MS, healthy: true, upToDate: true }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: LIVE_CHECKED_REFRESH_MS - 1, healthy: true, upToDate: true }), false);
  assert.equal(backupRefreshDue({ sinceSyncMs: LIVE_CHECKED_REFRESH_MS, healthy: true, upToDate: true }), true);
  // «Al día» no vale sin canal sano (el ping que lo confirmó es de antes de un corte o de un canal ya mudo).
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_MS, healthy: false, upToDate: true }), true);
  // Sin dato (servidor anterior, cuyo ping no trae posición): los 15 minutos de siempre.
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_LIVE_MS, healthy: true }), true);
  assert.equal(backupRefreshDue({ sinceSyncMs: BACKUP_REFRESH_LIVE_MS, healthy: true, upToDate: false }), true);
  // Al volver a la ventana: tampoco a los 5 minutos; sí pasada la hora.
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_LIVE_MS, channelOpen: true, channelGap: false, upToDate: true }), false);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: LIVE_CHECKED_REFRESH_MS, channelOpen: true, channelGap: false, upToDate: true }), true);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_LIVE_MS, channelOpen: true, channelGap: false, upToDate: false }), true);
  // Un corte manda sobre «al día»; sin canal abierto, el minuto de siempre.
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_GAP_MS, channelOpen: true, channelGap: true, upToDate: true }), true);
  assert.equal(shouldRefreshOnFocus({ sinceSyncMs: FOCUS_REFRESH_MIN_MS, channelOpen: false, channelGap: false, upToDate: true }), true);
  // «Al día» caduca como «sano»: si dejan de llegar pings con posición, al minuto vuelven los plazos normales.
  assert.equal(cursorChecked({ sinceCheckMs: 25_000 }), true);
  assert.equal(cursorChecked({ sinceCheckMs: LIVE_HEALTHY_MS }), false);
  assert.equal(cursorChecked({ sinceCheckMs: Infinity }), false);
});
