// Avisos push del navegador (Web Push sin dependencias): cifrado aes128gcm con el vector del RFC 8291 (apéndice A), firma
// VAPID (RFC 8292) comprobada con la clave pública, lista cerrada de servicios push (SSRF), mensaje y textos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeBrowser, checkVapid } from "./web-push-fake";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const core = await import("../src/lib/web-push-core");
const { pushNoticeMessage } = await import("../src/lib/web-push-text");
const { makeT } = await import("../src/i18n/core");

// RFC 8291, apéndice A.
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("cifrado aes128gcm: el vector del RFC 8291 da exactamente el cuerpo del apéndice A", () => {
  const out = core.encryptPushPayload(core.fromB64url(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { asPrivate: core.fromB64url(RFC.asPrivate), salt: core.fromB64url(RFC.salt) });
  assert.equal(out.toString("base64url"), RFC.body);
  // Y el navegador del RFC lo descifra.
  const ua = fakeBrowser(core.fromB64url(RFC.uaPrivate), core.fromB64url(RFC.auth));
  assert.equal(ua.keys.p256dh, RFC.uaPublic);
  assert.equal(ua.decrypt(out).toString(), "When I grow up, I want to be a watermelon");
});

test("cifrado: claves y sal nuevas en cada aviso, y lo descifra solo el navegador suscrito", () => {
  const ua = fakeBrowser();
  const text = Buffer.from(JSON.stringify({ title: "Ana te ha mencionado en «Tarea»" }));
  const a = core.encryptPushPayload(text, ua.keys);
  const b = core.encryptPushPayload(text, ua.keys);
  assert.notEqual(a.toString("hex"), b.toString("hex"));
  assert.equal(a.readUInt32BE(16), 4096);
  assert.equal(a[20], 65);
  assert.deepEqual(ua.decrypt(a), text);
  assert.throws(() => fakeBrowser().decrypt(a));
  // Un aviso mayor de lo que admiten los servicios push no se cifra.
  assert.throws(() => core.encryptPushPayload(Buffer.alloc(core.PUSH_PAYLOAD_MAX + 1), ua.keys), /máximo/);
  assert.ok(core.encryptPushPayload(Buffer.alloc(core.PUSH_PAYLOAD_MAX), ua.keys).length <= 4096);
});

test("claves del navegador: tamaños, base64url y punto de la curva", () => {
  const ua = fakeBrowser();
  assert.deepEqual(core.validPushKeys(ua.keys), ua.keys);
  assert.equal(core.validPushKeys({ p256dh: ua.keys.p256dh }), null);
  assert.equal(core.validPushKeys({ p256dh: ua.keys.p256dh, auth: "AAAA" }), null);
  // 65 bytes que empiezan por 04 pero no son un punto de P-256.
  assert.equal(core.validPushKeys({ p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: ua.keys.auth }), null);
  assert.equal(core.validPushKeys({ p256dh: "no es base64!", auth: ua.keys.auth }), null);
  assert.equal(core.validPushKeys(null), null);
});

test("VAPID: JWT ES256 con aud = origen del endpoint, exp en 12 h y sub; lo verifica la clave pública de la cabecera", () => {
  const keys = core.generateVapidKeys();
  assert.equal(core.fromB64url(keys.publicKey).length, 65);
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";
  const now = 1_800_000_000;
  const h = core.pushRequestHeaders(endpoint, "mailto:soporte@example.com", keys, { nowSec: now });
  const v = checkVapid(h.Authorization, "https://fcm.googleapis.com", now);
  assert.equal(v.sub, "mailto:soporte@example.com");
  assert.equal(v.k, keys.publicKey);
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.equal(h.TTL, "86400");
  const claims = JSON.parse(Buffer.from(h.Authorization.split(" ")[1]!.slice(2).split(".")[1]!, "base64url").toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now + 12 * 3600, sub: "mailto:soporte@example.com" });
  // Con otra clave la firma no vale.
  const other = core.generateVapidKeys();
  const forged = h.Authorization.replace(/k=.*$/, `k=${other.publicKey}`);
  assert.throws(() => checkVapid(forged, "https://fcm.googleapis.com", now), /firma/);
  // La JWK guardada rehace el mismo par; una JWK manipulada no vale.
  assert.equal(core.vapidFromJwk(keys.privateJwk).publicKey, keys.publicKey);
  assert.throws(() => core.vapidFromJwk({ ...keys.privateJwk, x: other.privateJwk.x }));
  assert.throws(() => core.vapidFromJwk({ kty: "RSA" }));
});

test("VAPID: contacto mailto con el email público y, si no hay, la dirección de la app", () => {
  assert.equal(core.vapidSubject(" hola@example.com ", "https://pizarro.example.com"), "mailto:hola@example.com");
  assert.equal(core.vapidSubject("", "https://pizarro.example.com"), "https://pizarro.example.com");
  assert.equal(core.vapidSubject("no es un email", "https://pizarro.example.com"), "https://pizarro.example.com");
});

test("servicios push: solo https y los hosts de la lista cerrada (contra SSRF)", () => {
  const ok = [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://wns2-par02p.notify.windows.com/w/?token=AwYAAA",
    "https://FCM.googleapis.com/x",
  ];
  for (const u of ok) assert.ok(core.pushEndpointHost(u), u);
  const bad = [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com",
    "https://notify.windows.com/x",
    "https://a.b.notify.windows.com/x",
    "https://evilnotify.windows.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "no es una url",
    `https://fcm.googleapis.com/${"a".repeat(core.PUSH_ENDPOINT_MAX)}`,
    42,
    null,
  ];
  for (const u of bad) assert.equal(core.pushEndpointHost(u), null, String(u));
  assert.equal(core.pushServiceName("wns2-par02p.notify.windows.com"), "Microsoft");
  assert.equal(core.pushServiceName("web.push.apple.com"), "Apple");
});

test("respuesta del servicio push: 201 enviado, 404/410 caducada, lo demás fallo", () => {
  assert.equal(core.pushOutcome(201), "sent");
  assert.equal(core.pushOutcome(200), "sent");
  assert.equal(core.pushOutcome(410), "expired");
  assert.equal(core.pushOutcome(404), "expired");
  for (const s of [400, 401, 403, 413, 429, 500, 503]) assert.equal(core.pushOutcome(s), "failed");
});

test("mensaje: ruta del mismo origen, textos recortados y sin saltos de línea", () => {
  assert.equal(core.samePath("https://pizarro.example.com/p/a?task=b", "https://pizarro.example.com"), "/p/a?task=b");
  assert.equal(core.samePath("https://evil.example/p", "https://pizarro.example.com"), "/");
  assert.equal(core.samePath("//evil.example/p", "https://pizarro.example.com"), "/");
  assert.equal(core.samePath("/notifications", "https://pizarro.example.com"), "/notifications");
  const json = JSON.parse(core.pushMessageJson({ title: `Ana\nte ha mencionado ${"x".repeat(400)}`, body: "Proyecto", url: "//evil.example", tag: "n1", icon: "/icon.png" }).toString());
  assert.equal(json.url, "/");
  assert.ok(json.title.length <= 200 && json.title.endsWith("…"));
  assert.ok(!json.title.includes("\n"));
});

test("texto del aviso push: quién y qué tarea (o nota), el proyecto y la ruta; sin el comentario ni el párrafo", () => {
  const t = makeT("es");
  const base = { actorName: "Ana", taskTitle: "Preparar «la» demo", projectName: "Web", url: "https://pizarro.example.com/p/p1?task=t1", locale: "es-ES" };
  const comment = pushNoticeMessage({ ...base, type: "COMMENT", excerpt: "texto privado del comentario" }, t, "https://pizarro.example.com", "/icon.png", "n1");
  assert.match(comment.title, /Ana/);
  assert.match(comment.title, /Preparar/);
  assert.ok(!JSON.stringify(comment).includes("texto privado"));
  assert.equal(comment.body, "Web");
  assert.equal(comment.url, "/p/p1?task=t1");
  const note = pushNoticeMessage({ ...base, type: "MENTION", note: true, taskTitle: "Acta", excerpt: "párrafo con @Bea", url: "https://pizarro.example.com/p/p1/docs?doc=d1" }, t, "https://pizarro.example.com", "/icon.png", "n2");
  assert.match(note.title, /nota/);
  assert.ok(!JSON.stringify(note).includes("párrafo"));
  assert.equal(note.url, "/p/p1/docs?doc=d1");
  const en = pushNoticeMessage({ ...base, type: "ASSIGNED", excerpt: "" }, makeT("en"), "https://pizarro.example.com", "/icon.png", "n3");
  assert.match(en.title, /“Preparar «la» demo”/);
});

test("cabeceras: un JWT ya firmado (guardado por servicio) se reutiliza tal cual; tiempo máximo de 5 s", () => {
  const keys = core.generateVapidKeys();
  const endpoint = "https://web.push.apple.com/abc";
  const jwt = core.vapidJwt(endpoint, "https://pizarro.example.com", keys, 1_800_000_000);
  const h = core.pushRequestHeaders(endpoint, "https://pizarro.example.com", keys, { jwt });
  assert.equal(h.Authorization, `vapid t=${jwt}, k=${keys.publicKey}`);
  checkVapid(h.Authorization, "https://web.push.apple.com", 1_800_000_000);
  assert.equal(core.PUSH_TIMEOUT_MS, 5_000);
});

// --- service worker, icono de la barra de estado y renovación ---

/** Carga public/sw.js en un `self` falso y devuelve sus oyentes y lo que hizo (notificaciones y peticiones). */
async function loadWorker(opts: { fetchOk?: boolean } = {}) {
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const requests: { url: string; init?: { method?: string; body?: string } }[] = [];
  const subscribed: unknown[] = [];
  const self = {
    location: { origin: "https://pizarro.example.com" },
    addEventListener: (name: string, fn: (e: unknown) => void) => (listeners[name] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => (shown.push({ title, options }), Promise.resolve()),
      pushManager: {
        getSubscription: async () => null,
        subscribe: async (o: unknown) => (subscribed.push(o), { endpoint: "https://fcm.googleapis.com/fcm/send/nuevo", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/nuevo", keys: { p256dh: "P", auth: "A" } }) }),
      },
    },
  };
  const ctx = {
    self, URL, TextEncoder, Uint8Array, Array, JSON, Promise, atob, crypto: globalThis.crypto, Boolean, String,
    fetch: async (url: string, init?: { method?: string; body?: string }) => (requests.push({ url, init }), { ok: opts.fetchOk ?? true, json: async () => ({ publicKey: "BAAA" }) }),
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), ctx);
  const waited: Promise<unknown>[] = [];
  const fire = (name: string, extra: Record<string, unknown> = {}) => listeners[name]!({ waitUntil: (p: Promise<unknown>) => waited.push(p), ...extra });
  return { fire, shown, requests, subscribed, settle: () => Promise.all(waited) };
}

test("service worker: el badge es la silueta monocroma, con vibración corta y renotify solo con tag", async () => {
  const w = await loadWorker();
  w.fire("push", { data: { json: () => ({ title: "T", body: "B", url: "/p/x", tag: "n1", icon: "/app-icon/blue/icon-192.png" }) } });
  w.fire("push", { data: { json: () => ({ title: "Sin tag", body: "" }) } });
  await w.settle();
  const [withTag, noTag] = w.shown;
  assert.equal(withTag!.options.badge, "/push-badge.png");
  assert.equal(withTag!.options.icon, "/app-icon/blue/icon-192.png");
  assert.deepEqual(Array.from(withTag!.options.vibrate as number[]), [120, 60, 120]);
  assert.equal(withTag!.options.renotify, true);
  assert.equal(noTag!.options.renotify, false, "renotify sin tag lanza TypeError en el navegador");
  assert.equal(noTag!.options.icon, "/icon.png");
});

test("public/push-badge.png: 96×96, blanco puro sobre transparente (Android solo usa el canal alfa)", async () => {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(new URL("../public/push-badge.png", import.meta.url).pathname).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [96, 96, 4]);
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;
    opaque++;
    assert.deepEqual([data[i], data[i + 1], data[i + 2]], [255, 255, 255]);
  }
  assert.ok(opaque > 500 && opaque < 96 * 96 * 0.6, "tiene silueta, no un cuadrado lleno");
  assert.equal(data[3], 0, "la esquina es transparente");
});

test("la ruta del badge no pasa por el proxy (se pide sin sesión, como icon.png)", async () => {
  const { config } = await import("../src/proxy");
  const re = new RegExp(`^${config.matcher[0]!}$`);
  assert.equal(re.test("/push-badge.png"), false);
  assert.equal(re.test("/icon.png"), false);
  assert.equal(re.test("/api/push/renew"), true, "la renovación sí exige sesión");
});

test("pushsubscriptionchange: se suscribe con la clave de la vieja y avisa al servidor con la huella de la vieja", async () => {
  const w = await loadWorker();
  const oldEndpoint = "https://fcm.googleapis.com/fcm/send/viejo";
  const key = new Uint8Array([4, 1, 2, 3]);
  w.fire("pushsubscriptionchange", { oldSubscription: { endpoint: oldEndpoint, options: { applicationServerKey: key.buffer } }, newSubscription: null });
  await w.settle();
  assert.equal(w.subscribed.length, 1);
  const opts = w.subscribed[0] as { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer };
  assert.equal(opts.userVisibleOnly, true);
  assert.deepEqual(Array.from(new Uint8Array(opts.applicationServerKey)), [4, 1, 2, 3]);
  assert.equal(w.requests.length, 1);
  const [req] = w.requests;
  assert.equal(req!.url, "/api/push/renew");
  assert.equal(req!.init?.method, "POST");
  const { createHash } = await import("node:crypto");
  assert.deepEqual(JSON.parse(req!.init!.body!), { oldHash: createHash("sha256").update(oldEndpoint).digest("hex"), endpoint: "https://fcm.googleapis.com/fcm/send/nuevo", keys: { p256dh: "P", auth: "A" } });
});

test("pushsubscriptionchange: sin la suscripción vieja no se sabe cuál cambiar (lo hace la página) y un fallo no rompe el worker", async () => {
  const w = await loadWorker();
  w.fire("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
  await w.settle();
  assert.equal(w.requests.length, 0);
  const failing = await loadWorker({ fetchOk: false });
  failing.fire("pushsubscriptionchange", { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/v", options: {} } });
  await failing.settle();
  assert.equal(failing.subscribed.length, 0, "si no hay clave pública, no se suscribe");
});

test("dónde mirar si el aviso de prueba no se ve: sistema y navegador", async () => {
  const { notificationSettingsHint } = await import("../src/lib/push-client");
  assert.deepEqual(notificationSettingsHint("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"), { os: "windows", browser: "Google Chrome" });
  assert.deepEqual(notificationSettingsHint("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130.0"), { os: "windows", browser: "Microsoft Edge" });
  assert.deepEqual(notificationSettingsHint("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/130.0"), { os: "mac", browser: "Firefox" });
  assert.equal(notificationSettingsHint("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36").os, "other");
});
