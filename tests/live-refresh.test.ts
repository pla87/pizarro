// Refresco escalonado del tablero: los cambios de otras personas refrescan tras una espera al azar (0–2 s por defecto),
// para que todas las pestañas abiertas no pidan el tablero a la vez; lo propio no espera.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIVE_REFRESH_JITTER_MS, foreignRefreshDelay, type IncomingChange } from "../src/components/board/remoteChange";
import { liveRefreshJitterMs } from "../src/lib/live-refresh";

const other: IncomingChange = { cid: "c-otro", change: { action: "tasks.move", userId: "u2" }, announced: true };
const myOtherTab: IncomingChange = { cid: "c-pestaña", change: { action: "tasks.move", userId: "u1" }, announced: false };
const mine: IncomingChange = { cid: "c-mío", change: { action: "tasks.move", userId: "u1" }, announced: false };

test("foreignRefreshDelay: al azar entre 0 y el máximo solo si algo es de otra persona", () => {
  const own = new Set(["c-mío"]);
  assert.equal(foreignRefreshDelay([other], own, 2000, () => 0.5), 1000);
  assert.equal(foreignRefreshDelay([other], own, 2000, () => 0), 0);
  assert.ok(foreignRefreshDelay([other], own, 2000, () => 0.9999) < 2000);
  // Mezclado con lo propio: espera igual (un solo refresco para todo).
  assert.equal(foreignRefreshDelay([mine, other, myOtherTab], own, 2000, () => 0.25), 500);
  // Solo lo de la propia persona (esta pestaña u otra): sin espera.
  assert.equal(foreignRefreshDelay([mine], own, 2000, () => 0.5), 0);
  assert.equal(foreignRefreshDelay([myOtherTab], own, 2000, () => 0.5), 0);
  // Aviso ilegible (sin cid ni autor): cuenta como ajeno, como en settleIncoming.
  assert.equal(foreignRefreshDelay([{ cid: null, change: null, announced: true }], own, 2000, () => 0.5), 1000);
  // Desactivado o con valores raros.
  assert.equal(foreignRefreshDelay([other], own, 0, () => 0.5), 0);
  assert.equal(foreignRefreshDelay([other], own, Number.NaN, () => 0.5), 0);
  assert.equal(foreignRefreshDelay([other], own, 60_000, () => 0.5), 5000, "tope de 10 s");
  assert.equal(foreignRefreshDelay([other], own, 2000, () => 7), 2000);
  assert.ok(own.has("c-mío"), "no toca los ids propios (eso lo hace settleIncoming)");
});

test("liveRefreshJitterMs: 2000 por defecto, 0 lo quita, tope de 10 s", () => {
  assert.equal(liveRefreshJitterMs({}), DEFAULT_LIVE_REFRESH_JITTER_MS);
  assert.equal(DEFAULT_LIVE_REFRESH_JITTER_MS, 2000);
  assert.equal(liveRefreshJitterMs({ LIVE_REFRESH_JITTER_MS: "0" }), 0);
  assert.equal(liveRefreshJitterMs({ LIVE_REFRESH_JITTER_MS: " 500 " }), 500);
  assert.equal(liveRefreshJitterMs({ LIVE_REFRESH_JITTER_MS: "999999" }), 10_000);
  assert.equal(liveRefreshJitterMs({ LIVE_REFRESH_JITTER_MS: "-5" }), 2000);
  assert.equal(liveRefreshJitterMs({ LIVE_REFRESH_JITTER_MS: "abc" }), 2000);
});
