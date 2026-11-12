// Sin red o con el servidor caído: no se pide la página (Next la cambiaría por la de error del navegador), el refresco
// queda pendiente y se hace al volver; mensajes de las acciones que no llegan al servidor (src/lib/connection.ts).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  isNetworkError, isOffline, isOfflineMessage, OFFLINE_MESSAGE, probeServer, refreshWhenOnline, reportOffline, reportReachable,
  resetConnectionForTests, safeRefresh, subscribeConnection,
} from "../src/lib/connection";
import { actionThrowMessage } from "../src/lib/stale-action";

type Health = "ok" | "down" | "shutting_down" | "disk" | "proxy502";
let health: Health = "ok";
let probes = 0;
const listeners = new Map<string, Set<() => void>>();
let online = true;

function installBrowser() {
  const g = globalThis as Record<string, unknown>;
  g.window = {
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return online; } } });
  g.fetch = async (url: string) => {
    assert.equal(url, "/api/health");
    probes++;
    if (health === "down") throw new TypeError("Failed to fetch");
    if (health === "ok") return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (health === "proxy502") return new Response("Bad gateway", { status: 502 });
    return new Response(JSON.stringify({ status: "error", reason: health === "disk" ? "low_disk_space" : "shutting_down" }), { status: 503 });
  };
}
const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("refresco seguro (safeRefresh)", () => {
  beforeEach(() => {
    installBrowser();
    resetConnectionForTests();
    health = "ok";
    online = true;
    probes = 0;
  });
  afterEach(() => resetConnectionForTests());

  test("con el servidor respondiendo refresca al momento", async () => {
    let n = 0;
    assert.equal(await safeRefresh(() => n++), true);
    assert.equal(n, 1);
    assert.equal(isOffline(), false);
  });

  test("con el servidor caído no refresca: queda pendiente, avisa y lo hace al volver la red", async () => {
    health = "down";
    let n = 0;
    let changes = 0;
    subscribeConnection(() => changes++);
    const refresh = () => n++;
    assert.equal(await safeRefresh(refresh), false);
    assert.equal(n, 0, "sin servidor no se pide la página");
    assert.equal(isOffline(), true);
    assert.equal(changes, 1);
    // Otro refresco con la misma clave no se apila.
    await safeRefresh(refresh);
    health = "ok";
    fire("online");
    await tick();
    await tick();
    assert.equal(n, 1, "al volver se hace una sola vez");
    assert.equal(isOffline(), false);
    assert.equal(changes, 2);
  });

  test("sin red (navigator.onLine) ni se intenta el sondeo", async () => {
    online = false;
    let n = 0;
    assert.equal(await safeRefresh(() => n++), false);
    assert.equal(probes, 0);
    assert.equal(n, 0);
  });

  test("503 por disco lleno cuenta como que responde; mientras se apaga, o un 502 del proxy, no", async () => {
    health = "disk";
    assert.equal(await probeServer(), true);
    resetConnectionForTests();
    health = "shutting_down";
    assert.equal(await probeServer(), false);
    health = "proxy502";
    assert.equal(await probeServer(), false);
  });

  test("varios refrescos seguidos comparten un sondeo", async () => {
    await Promise.all([safeRefresh(() => {}), safeRefresh(() => {}, "b"), safeRefresh(() => {}, "c")]);
    await safeRefresh(() => {}, "d");
    assert.equal(probes, 1);
  });

  test("una acción que no llega deja el refresco para cuando vuelva; una que llega lo hace al momento", async () => {
    let n = 0;
    reportOffline();
    refreshWhenOnline(() => n++, "tablero");
    assert.equal(isOffline(), true);
    assert.equal(n, 0);
    reportReachable();
    assert.equal(isOffline(), false);
    assert.equal(n, 1);
  });
});

describe("acciones que no llegan al servidor", () => {
  test("reconoce los errores de red de cada navegador", () => {
    online = true;
    installBrowser();
    assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
    assert.equal(isNetworkError(new TypeError("NetworkError when attempting to fetch resource.")), true);
    assert.equal(isNetworkError(new TypeError("Load failed")), true);
    assert.equal(isNetworkError(new Error("Failed to find Server Action")), false);
    assert.equal(isNetworkError(new TypeError("x is not a function")), false);
    online = false;
    assert.equal(isNetworkError(new Error("cualquiera")), true, "sin red, cualquier fallo es de red");
    online = true;
  });

  test("el aviso es «Sin conexión: no se ha guardado» en vez de «Error inesperado»", () => {
    installBrowser();
    online = true;
    assert.equal(actionThrowMessage(new TypeError("Failed to fetch"), (s) => s), OFFLINE_MESSAGE);
    assert.equal(actionThrowMessage(new Error("boom"), (s) => s), "Error inesperado. Inténtalo de nuevo.");
    assert.equal(isOfflineMessage("Offline: not saved", (s) => (s === OFFLINE_MESSAGE ? "Offline: not saved" : s)), true);
    assert.equal(isOfflineMessage("Error inesperado. Inténtalo de nuevo.", (s) => s), false);
  });
});
