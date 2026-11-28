// Resincronización en silencio de los avisos push del navegador (src/lib/push-sync-core.ts): con navigator, window,
// Notification y el almacenamiento falsos y el servidor sustituido por funciones de prueba.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { makeResync } = await import("../src/lib/push-sync-core");
const { sha256Hex } = await import("../src/lib/push-client");

// --- Navegador falso ---

class Store {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
}

const KEY_BYTES = new Uint8Array(65).map((_, i) => (i * 7 + 1) & 255);
const PUBLIC_KEY = Buffer.from(KEY_BYTES).toString("base64url");

function fakeSub(endpoint: string, key: Uint8Array = KEY_BYTES) {
  return {
    endpoint,
    options: { applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) },
    unsubscribed: false,
    toJSON() { return { endpoint, keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } }; },
    async unsubscribe() { this.unsubscribed = true; return true; },
  };
}
type Sub = ReturnType<typeof fakeSub>;

const browser = { sub: null as Sub | null, subscribed: [] as Sub[], permission: "granted" };
const local = new Store();
const session = new Store();

function installBrowser() {
  const reg = {
    pushManager: {
      getSubscription: async () => browser.sub,
      subscribe: async () => {
        const s = fakeSub(`https://push.example.com/new-${browser.subscribed.length + 1}`);
        browser.subscribed.push(s);
        browser.sub = s;
        return s;
      },
    },
  };
  const nav = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120", platform: "Linux", maxTouchPoints: 0, serviceWorker: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) } };
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", { isSecureContext: true, PushManager: class {}, Notification: class {} });
  define("navigator", nav);
  define("Notification", Object.defineProperty(class {}, "permission", { get: () => browser.permission }));
  define("localStorage", local);
  define("sessionStorage", session);
}

beforeEach(() => {
  browser.sub = null;
  browser.subscribed = [];
  browser.permission = "granted";
  local.data.clear();
  session.data.clear();
  installBrowser();
});

/** Servidor falso: los dispositivos que «tiene» la cuenta y lo que se le pide. */
function fakeServer(devices: string[], publicKey = PUBLIC_KEY) {
  const calls = { setup: 0, renew: [] as { oldHash: string; endpoint: string }[] };
  return {
    calls,
    deps: {
      pushSetup: async () => { calls.setup++; return { ok: true as const, data: { publicKey, devices: devices.map((hash) => ({ hash })) } }; },
      renewPush: async (input: { oldHash: string; endpoint: string; keys: { p256dh: string; auth: string } }) => { calls.renew.push({ oldHash: input.oldHash, endpoint: input.endpoint }); return { ok: true }; },
    },
  };
}

const HASH_KEY = "pz-push-hash";

test("sin huella guardada, sin permiso o con la suscripción igual a la guardada: no hace nada", async () => {
  const sub = fakeSub("https://push.example.com/a");
  browser.sub = sub;
  const server = fakeServer([]);
  const resync = makeResync(server.deps);
  assert.equal(await resync(), false); // sin huella
  local.setItem(HASH_KEY, await sha256Hex(sub.endpoint));
  assert.equal(await resync(), false); // igual: ni siquiera pregunta al servidor
  assert.equal(server.calls.setup, 0);
  local.setItem(HASH_KEY, "otra");
  browser.permission = "denied";
  assert.equal(await resync(), false);
  assert.equal(server.calls.setup, 0);
  assert.equal(local.getItem(HASH_KEY), "otra");
});

test("quitado desde otro dispositivo: no se vuelve a suscribir ni a renovar, y la huella se olvida", async () => {
  local.setItem(HASH_KEY, await sha256Hex("https://push.example.com/old"));
  browser.sub = null; // el navegador perdió la suscripción
  const server = fakeServer([]); // la fila ya no está
  assert.equal(await makeResync(server.deps)(), false);
  assert.deepEqual(server.calls.renew, []);
  assert.deepEqual(browser.subscribed, []);
  assert.equal(local.getItem(HASH_KEY), null);
});

test("suscripción cambiada y fila presente: renueva con la huella guardada y actualiza la huella", async () => {
  const oldHash = await sha256Hex("https://push.example.com/old");
  local.setItem(HASH_KEY, oldHash);
  const current = fakeSub("https://push.example.com/current", new Uint8Array(KEY_BYTES.map((v) => v ^ 1))); // otra clave del servidor
  browser.sub = current;
  const server = fakeServer([oldHash]);
  assert.equal(await makeResync(server.deps)(), true);
  assert.equal(current.unsubscribed, true);
  assert.equal(browser.subscribed.length, 1);
  assert.deepEqual(server.calls.renew, [{ oldHash, endpoint: "https://push.example.com/new-1" }]);
  assert.equal(local.getItem(HASH_KEY), await sha256Hex("https://push.example.com/new-1"));
});

test("suscripción distinta pero con la clave buena: se renueva sin suscribirse otra vez", async () => {
  const oldHash = await sha256Hex("https://push.example.com/old");
  local.setItem(HASH_KEY, oldHash);
  browser.sub = fakeSub("https://push.example.com/current");
  const server = fakeServer([oldHash]);
  assert.equal(await makeResync(server.deps)(), true);
  assert.deepEqual(browser.subscribed, []);
  assert.deepEqual(server.calls.renew, [{ oldHash, endpoint: "https://push.example.com/current" }]);
  assert.equal(local.getItem(HASH_KEY), await sha256Hex("https://push.example.com/current"));
});

test("varias cuentas en el mismo navegador: la huella de otra cuenta no se reactiva ni se renueva", async () => {
  // La huella guardada es de la cuenta A; ahora entró B, cuyos dispositivos son otros. La suscripción actual es la de A.
  const hashA = await sha256Hex("https://push.example.com/cuenta-a");
  const hashB = await sha256Hex("https://push.example.com/cuenta-b");
  local.setItem(HASH_KEY, hashA);
  browser.sub = fakeSub("https://push.example.com/cuenta-a-nueva");
  const server = fakeServer([hashB]);
  assert.equal(await makeResync(server.deps)(), false);
  assert.deepEqual(server.calls.renew, []);
  assert.deepEqual(browser.subscribed, []);
  // La huella se alinea: no es de B ni la suscripción actual está en B.
  assert.equal(local.getItem(HASH_KEY), null);
  // Si la suscripción actual sí fuera un dispositivo de B, se adopta esa huella.
  const mine = await sha256Hex("https://push.example.com/b-actual");
  browser.sub = fakeSub("https://push.example.com/b-actual");
  local.setItem(HASH_KEY, hashA);
  assert.equal(await makeResync(fakeServer([mine]).deps)(), false);
  assert.equal(local.getItem(HASH_KEY), mine);
});

test("con once, solo una vez por pestaña; sin once, siempre", async () => {
  local.setItem(HASH_KEY, "vieja");
  browser.sub = fakeSub("https://push.example.com/x");
  const server = fakeServer([]);
  const resync = makeResync(server.deps);
  await resync({ once: true });
  local.setItem(HASH_KEY, "vieja");
  await resync({ once: true });
  assert.equal(server.calls.setup, 1);
  local.setItem(HASH_KEY, "vieja");
  await resync();
  assert.equal(server.calls.setup, 2);
});

test("dos peticiones a la vez comparten una sola promesa y una sola renovación", async () => {
  const oldHash = await sha256Hex("https://push.example.com/old");
  local.setItem(HASH_KEY, oldHash);
  browser.sub = fakeSub("https://push.example.com/current");
  const server = fakeServer([oldHash]);
  const resync = makeResync(server.deps);
  const a = resync({ once: true });
  const b = resync();
  assert.equal(a, b);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(server.calls.renew.length, 1);
  assert.equal(server.calls.setup, 1);
  // Terminada, la siguiente petición vuelve a mirar (ya sin cambios: la huella coincide).
  assert.notEqual(resync(), a);
  assert.equal(await resync(), false);
});

test("un fallo del servidor o del navegador no lanza", async () => {
  local.setItem(HASH_KEY, "vieja");
  browser.sub = fakeSub("https://push.example.com/x");
  const resync = makeResync({ pushSetup: async () => { throw new Error("red"); }, renewPush: async () => ({ ok: false }) });
  assert.equal(await resync(), false);
  assert.equal(await makeResync({ pushSetup: async () => ({ ok: false as const }), renewPush: async () => ({ ok: true }) })(), false);
});
