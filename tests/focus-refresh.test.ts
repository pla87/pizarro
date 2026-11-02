import assert from "node:assert/strict";
import { test } from "node:test";
import { FOCUS_REFRESH_GAP_MS, FOCUS_REFRESH_LIVE_MS, FOCUS_REFRESH_MIN_MS, shouldRefreshOnFocus } from "../src/lib/focus-refresh";

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
