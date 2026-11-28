// Avisos push del navegador contra PostgreSQL real y un servidor push falso en localhost (nunca se llama a Google, Mozilla,
// Apple ni Microsoft): las peticiones a los hosts de la lista cerrada se desvían a ese servidor, que descifra el aviso
// como un navegador y comprueba el JWT VAPID. Claves de la instalación, suscribir (con su tope y la lista de servicios),
// borrar la cuenta, envío según las preferencias por tipo, 410 = suscripción caducada, menciones en notas y «Probar».
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { afterDone, asUser, db, expectFail, expectOk, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { fakeBrowser, fakePushServer, checkVapid, type FakeBrowser, type PushHit } from "../web-push-fake";

process.env.APP_URL = "https://pizarro.example.com";

const { pushSetup, removePushDevice, renewPush, savePushPrefs, subscribePush, testPush, unsubscribePush } = await import("../../src/actions/push");
const renewRoute = await import("../../src/app/api/push/renew/route");
const { endpointHash } = await import("../../src/lib/web-push");
const { forgetVapidKeys, vapidKeys } = await import("../../src/lib/web-push");
const { notifyTask } = await import("../../src/lib/notify");
const { createNote, saveNote } = await import("../../src/actions/documents");
const { mentionToken } = await import("../../src/lib/mentions");
const { decryptSecret } = await import("../../src/lib/crypto");
const { flushLogs } = await import("../../src/lib/log");
const { PUSH_VAPID_KEY, PUSH_TIMEOUT_MS } = await import("../../src/lib/web-push-core");
const { revokeOtherSessions, revokeSession } = await import("../../src/actions/profile");
const { currentSessionId } = await import("../../src/lib/session");

let server: Awaited<ReturnType<typeof fakePushServer>>;
/** Respuesta del servicio push falso por ruta del endpoint (201 si no se dice otra cosa). */
let statusFor: Record<string, number> = {};
const realFetch = globalThis.fetch;
/** Peticiones que salieron hacia un host que no es de la lista (no debe haber ninguna). */
let strays: string[] = [];

before(async () => {
  server = await fakePushServer((path) => statusFor[path] ?? 201);
});
after(async () => {
  await server.close();
});
beforeEach(() => {
  statusFor = {};
  strays = [];
  server.hits.length = 0;
  // Los servicios push de verdad se desvían al servidor falso (misma ruta, mismas cabeceras y cuerpo).
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname) && !url.hostname.endsWith(".notify.windows.com")) {
      strays.push(String(input));
      throw new Error(`fetch inesperado: ${String(input)}`);
    }
    assert.equal(init?.redirect, "error", "sin seguir redirecciones");
    assert.ok(init?.signal, "con tiempo máximo");
    return realFetch(`${server.url}/${url.hostname}${url.pathname}${url.search}`, { method: init?.method, headers: init?.headers, body: init?.body, signal: init?.signal });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(strays, []);
});

let seq = 0;
/** Un navegador nuevo con su endpoint (por defecto, de FCM). */
function browser(host = "fcm.googleapis.com"): FakeBrowser & { endpoint: string; path: string } {
  const b = fakeBrowser();
  const path = `/fcm/send/dev-${process.pid}-${++seq}`;
  return { ...b, endpoint: `https://${host}${path}`, path: `/${host}${path}` };
}

async function subscribe(user: { id: string }, b: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return asUser(user, () => subscribePush({ endpoint: b.endpoint, keys: b.keys }));
}

/** Lo que recibió el servidor push falso para este navegador, descifrado (y con el JWT VAPID comprobado). */
function received(b: FakeBrowser & { path: string }): { title: string; body: string; url: string; tag: string; icon: string }[] {
  return server.hits
    .filter((h: PushHit) => h.path === b.path)
    .map((h) => {
      checkVapid(String(h.headers.authorization), `https://${b.path.split("/")[1]}`);
      assert.equal(h.headers["content-encoding"], "aes128gcm");
      assert.ok(Number(h.headers.ttl) > 0);
      return JSON.parse(b.decrypt(h.body).toString());
    });
}

describe("avisos push: claves y dispositivos", () => {
  test("la clave VAPID se crea sola una vez, cifrada, y se reutiliza (también tras reiniciar)", async () => {
    const a = await vapidKeys();
    forgetVapidKeys();
    const b = await vapidKeys();
    assert.equal(a.publicKey, b.publicKey);
    const row = await db.appState.findUniqueOrThrow({ where: { key: PUSH_VAPID_KEY } });
    assert.ok(!row.value.includes(a.privateJwk.d), "la clave privada no se guarda en claro");
    assert.equal(JSON.parse(decryptSecret(row.value)).d, a.privateJwk.d);
    const ana = await makeUser();
    assert.equal(expectOk(await asUser(ana, () => pushSetup())).publicKey, a.publicKey);
  });

  test("suscribir: solo servicios conocidos y claves válidas; el endpoint y las claves se guardan cifrados", async () => {
    const ana = await makeUser();
    const b = browser();
    const { id } = expectOk(await subscribe(ana, b));
    const row = await db.pushSubscription.findUniqueOrThrow({ where: { id } });
    assert.ok(!row.endpointEnc.includes("fcm.googleapis.com") && !row.keysEnc.includes(b.keys.auth));
    assert.equal(decryptSecret(row.endpointEnc), b.endpoint);
    assert.equal(row.host, "fcm.googleapis.com");
    assert.equal(row.userAgent, "pizarro-db-tests");
    // Otra vez el mismo navegador: la misma fila.
    expectOk(await subscribe(ana, b));
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 1);
    // Fuera de la lista (SSRF) o sin https: no.
    for (const endpoint of ["https://169.254.169.254/latest/meta-data", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.example/x", "https://localhost/x"]) {
      expectFail(await subscribe(ana, { endpoint, keys: b.keys }), /no admite/);
    }
    expectFail(await subscribe(ana, { endpoint: browser().endpoint, keys: { p256dh: "AAAA", auth: b.keys.auth } }), /no válida/);
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 1);
    const view = expectOk(await asUser(ana, () => pushSetup()));
    assert.equal(view.devices.length, 1);
    assert.equal(view.devices[0]!.service, "Google");
    assert.ok(!JSON.stringify(view).includes(b.endpoint), "el endpoint no vuelve a la página");
  });

  test("tope de 10 dispositivos por persona; el mismo navegador con otra cuenta pasa a esa cuenta", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const shared = browser("updates.push.services.mozilla.com");
    expectOk(await subscribe(ana, shared));
    for (let i = 0; i < 9; i++) expectOk(await subscribe(ana, browser(i % 2 ? "web.push.apple.com" : "wns2-par02p.notify.windows.com")));
    expectFail(await subscribe(ana, browser()), /10 dispositivos/);
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 10);
    // Bea entra en el mismo navegador y activa los avisos: deja de recibirlos Ana.
    expectOk(await subscribe(bea, shared));
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 9);
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 1);
  });

  test("quitar un dispositivo, desactivar este y borrar la cuenta", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const b1 = browser();
    const b2 = browser();
    const { id: id1 } = expectOk(await subscribe(ana, b1));
    expectOk(await subscribe(ana, b2));
    // Nadie quita el de otra persona, y un id mal formado no llega a la base.
    expectFail(await asUser(bea, () => removePushDevice(id1)), /ya no está/);
    expectFail(await asUser(ana, () => removePushDevice("../x")), /ya no está/);
    expectOk(await asUser(ana, () => removePushDevice(id1)));
    // Desactivar con el endpoint de otra cuenta no toca nada.
    expectOk(await asUser(bea, () => unsubscribePush({ endpoint: b2.endpoint })));
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 1);
    expectOk(await asUser(ana, () => unsubscribePush({ endpoint: b2.endpoint })));
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 0);
    const b3 = browser();
    expectOk(await subscribe(bea, b3));
    await db.user.delete({ where: { id: bea.id } });
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 0);
  });
});

describe("avisos push: envío", () => {

  test("mención: llega cifrada al dispositivo con quién y qué tarea, sin el texto; pushSentAt y Logs sin el endpoint", async () => {
    const ana = await makeUser({ name: "Ana Push" });
    const bea = await makeUser({ name: "Bea Push" });
    const f = await makeProject({ members: [ana, bea] });
    const task = await makeTask(f, { title: "Preparar la demo" });
    const b = browser();
    expectOk(await subscribe(bea, b));
    await notifyTask({ type: "MENTION", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: "texto privado de la mención", immediate: true });
    const [msg, ...rest] = received(b);
    assert.equal(rest.length, 0);
    assert.match(msg!.title, /Ana Push te ha mencionado en «Preparar la demo»/);
    assert.equal(msg!.body, f.project.name);
    assert.equal(msg!.url, `/p/${f.project.id}?task=${task.id}`);
    assert.match(msg!.icon, /^\/app-icon\//);
    assert.ok(!JSON.stringify(msg).includes("texto privado"));
    const n = await db.notification.findFirstOrThrow({ where: { userId: bea.id, taskId: task.id } });
    assert.ok(n.pushSentAt);
    assert.equal(n.deliveryError, null);
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { userId: bea.id, action: { startsWith: "notify.push" } } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.action, "notify.push");
    assert.ok(!JSON.stringify(logs).includes(b.path.slice(1)), "el endpoint no va a Logs");
  });

  test("preferencias por tipo: los comentarios no salen por defecto; al marcarlos, sí", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const f = await makeProject({ members: [ana, bea] });
    const task = await makeTask(f);
    const b = browser();
    expectOk(await subscribe(bea, b));
    assert.deepEqual(expectOk(await asUser(bea, () => pushSetup())).prefs, { notifyMention: true, notifyAssigned: true, notifyDue: true, notifyComment: false });
    await notifyTask({ type: "COMMENT", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: "hola", immediate: true });
    assert.equal(received(b).length, 0);
    expectOk(await asUser(bea, () => savePushPrefs({ notifyMention: false, notifyAssigned: true, notifyDue: true, notifyComment: true })));
    const other = await makeTask(f);
    await notifyTask({ type: "COMMENT", actorId: ana.id, taskId: other.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: "hola", immediate: true });
    assert.equal(received(b).length, 1);
    assert.match(received(b)[0]!.title, /ha comentado/);
    // Las menciones, desmarcadas: ya no salen.
    const third = await makeTask(f);
    await notifyTask({ type: "MENTION", actorId: ana.id, taskId: third.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: "x", immediate: true });
    assert.equal(received(b).length, 1);
  });

  test("410 del servicio push: la suscripción caducada se borra y queda en Logs; las demás siguen", async () => {
    const ana = await makeUser();
    const bea = await makeUser({ name: "Bea Caducada" });
    const f = await makeProject({ members: [ana, bea] });
    const task = await makeTask(f);
    const gone = browser();
    const alive = browser("web.push.apple.com");
    expectOk(await subscribe(bea, gone));
    expectOk(await subscribe(bea, alive));
    statusFor[gone.path] = 410;
    await notifyTask({ type: "ASSIGNED", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: task.title, immediate: true });
    assert.equal(received(alive).length, 1);
    const left = await db.pushSubscription.findMany({ where: { userId: bea.id }, select: { host: true } });
    assert.deepEqual(left.map((r) => r.host), ["web.push.apple.com"]);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { userId: bea.id, action: "notify.pushExpired" } }), 1);
    // Un fallo del servicio (500) no borra nada y queda en deliveryError.
    statusFor[alive.path] = 500;
    const t2 = await makeTask(f);
    await notifyTask({ type: "ASSIGNED", actorId: ana.id, taskId: t2.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: t2.title, immediate: true });
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 1);
    const n = await db.notification.findFirstOrThrow({ where: { userId: bea.id, taskId: t2.id } });
    assert.equal(n.pushSentAt, null);
    assert.match(n.deliveryError ?? "", /push: HTTP 500/);
  });

  test("tope de 30 avisos push por persona y hora", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const f = await makeProject({ members: [ana, bea] });
    const b = browser();
    expectOk(await subscribe(bea, b));
    for (let i = 0; i < 32; i++) {
      const task = await makeTask(f);
      // Del sistema (sin autor): no lo corta el tope por autor de 40/h.
      await notifyTask({ type: "WAITING", actorId: null, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: "3", immediate: true });
    }
    assert.equal(received(b).length, 30);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { userId: bea.id, action: "notify.pushRateLimited" } }), 1);
  });

  test("mención en una nota de Documentación: sale por push (con el nombre de la nota, sin el párrafo)", async () => {
    const ana = await makeUser({ name: "Ana Nota" });
    const bea = await makeUser({ name: "Bea Nota" });
    const f = await makeProject({ members: [ana, bea] });
    const b = browser();
    expectOk(await subscribe(bea, b));
    const note = await asUser(ana, async () => expectOk(await createNote(f.project.id)));
    const { noteVersion } = await db.projectDocument.findUniqueOrThrow({ where: { id: note.id }, select: { noteVersion: true } });
    await asUser(ana, async () => expectOk(await saveNote(note.id, `Acta semanal\n\nRevisar el presupuesto con ${mentionToken(bea.name, bea.id)}`, noteVersion)));
    await afterDone();
    const [msg] = received(b);
    assert.ok(msg, "llega el aviso push");
    assert.match(msg.title, /Ana Nota te ha mencionado en la nota/);
    assert.equal(msg.url, `/p/${f.project.id}/docs?doc=${note.id}`);
    assert.ok(!JSON.stringify(msg).includes("presupuesto"));
    assert.ok((await db.notification.findFirstOrThrow({ where: { documentId: note.id, userId: bea.id } })).pushSentAt);
  });

  test("«Probar» exige la huella de este dispositivo: sin ella (o sin dispositivos), pide activar primero", async () => {
    const ana = await makeUser();
    expectFail(await asUser(ana, () => testPush()), /Activa primero/);
    const b = browser();
    expectOk(await subscribe(ana, b));
    expectFail(await asUser(ana, () => testPush()), /Activa primero/);
    expectFail(await asUser(ana, () => testPush({ hash: "no-es-una-huella" })), /Activa primero/);
    assert.equal(received(b).length, 0, "sin huella no se prueba a todos");
    assert.deepEqual(expectOk(await asUser(ana, () => testPush({ hash: endpointHash(b.endpoint) }))), { sent: 1, failed: 0, expired: 0 });
    const [msg] = received(b);
    assert.equal(msg!.title, "Aviso de prueba de Pizarro");
    assert.equal(msg!.url, "/settings?tab=avisos");
  });
});

describe("avisos push: «Probar» en este dispositivo y renovar la suscripción", () => {
  test("«Probar» con la huella de este dispositivo solo escribe a ese; con una huella desconocida, pide activar primero", async () => {
    const ana = await makeUser();
    const phone = browser();
    const pc = browser("wns2-par02p.notify.windows.com");
    expectOk(await subscribe(ana, phone));
    expectOk(await subscribe(ana, pc));
    assert.deepEqual(expectOk(await asUser(ana, () => testPush({ hash: endpointHash(pc.endpoint) }))), { sent: 1, failed: 0, expired: 0 });
    assert.equal(received(pc).length, 1);
    assert.equal(received(phone).length, 0);
    expectFail(await asUser(ana, () => testPush({ hash: endpointHash(browser().endpoint) })), /Activa primero/);
    // La huella de otra persona no sirve para escribirle: solo se miran los dispositivos de quien pulsa.
    const bea = await makeUser();
    expectFail(await asUser(bea, () => testPush({ hash: endpointHash(pc.endpoint) })), /Activa primero/);
    assert.equal(received(pc).length, 1);
  });

  test("renovar: la fila pasa al endpoint nuevo (mismo id), el viejo deja de recibir y el nuevo recibe", async () => {
    const ana = await makeUser();
    await loginAs(ana);
    const before = browser();
    const { id } = expectOk(await subscribePush({ endpoint: before.endpoint, keys: before.keys }));
    const after = browser();
    expectOk(await renewPush({ oldHash: endpointHash(before.endpoint), endpoint: after.endpoint, keys: after.keys }));
    const row = await db.pushSubscription.findUniqueOrThrow({ where: { id } });
    assert.equal(row.endpointHash, endpointHash(after.endpoint));
    assert.equal(decryptSecret(row.endpointEnc), after.endpoint);
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 1);
    expectOk(await testPush({ hash: endpointHash(after.endpoint) }));
    assert.equal(received(after).length, 1);
    assert.equal(received(before).length, 0);
    // Repetirlo con la huella vieja ya no encuentra nada.
    expectFail(await renewPush({ oldHash: endpointHash(before.endpoint), endpoint: after.endpoint, keys: after.keys }), /ya no está/);
  });

  test("renovar solo sustituye una suscripción propia de esta sesión", async () => {
    const ana = await makeUser();
    const mallory = await makeUser();
    await loginAs(ana);
    const mine = browser();
    expectOk(await subscribePush({ endpoint: mine.endpoint, keys: mine.keys }));
    const oldHash = endpointHash(mine.endpoint);
    const evil = browser();
    // Otra persona con la huella de Ana: nada.
    await loginAs(mallory);
    expectFail(await renewPush({ oldHash, endpoint: evil.endpoint, keys: evil.keys }), /ya no está/);
    // Otra sesión de la misma persona: tampoco (la suscripción es de la sesión que la hizo).
    await loginAs(ana);
    expectFail(await renewPush({ oldHash, endpoint: evil.endpoint, keys: evil.keys }), /ya no está/);
    // Huella mal formada o inventada.
    expectFail(await renewPush({ oldHash: "x", endpoint: evil.endpoint, keys: evil.keys }), /ya no está/);
    expectFail(await renewPush({ oldHash: "0".repeat(64), endpoint: evil.endpoint, keys: evil.keys }), /ya no está/);
    const row = await db.pushSubscription.findFirstOrThrow({ where: { userId: ana.id } });
    assert.equal(row.endpointHash, oldHash);
    assert.equal(await db.pushSubscription.count({ where: { endpointHash: endpointHash(evil.endpoint) } }), 0);
  });

  test("renovar: servicio fuera de la lista o claves no válidas no cambian nada; el endpoint de otra persona exige sus claves", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const theirs = browser();
    expectOk(await subscribe(bea, theirs));
    await loginAs(ana);
    const mine = browser();
    expectOk(await subscribePush({ endpoint: mine.endpoint, keys: mine.keys }));
    const oldHash = endpointHash(mine.endpoint);
    expectFail(await renewPush({ oldHash, endpoint: "https://169.254.169.254/x", keys: mine.keys }), /no admite/);
    expectFail(await renewPush({ oldHash, endpoint: browser().endpoint, keys: { p256dh: "AAAA", auth: mine.keys.auth } }), /no válida/);
    // Apuntar al endpoint de Bea con claves inventadas: no se lo quita.
    expectFail(await renewPush({ oldHash, endpoint: theirs.endpoint, keys: fakeBrowser().keys }), /no válida/);
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 1);
    assert.equal((await db.pushSubscription.findFirstOrThrow({ where: { userId: ana.id } })).endpointHash, oldHash);
  });

  test("ruta /api/push/renew (service worker): mismo origen y sesión; con una huella ajena, 404 sin tocar nada", async () => {
    const ana = await makeUser();
    await loginAs(ana);
    const before = browser();
    expectOk(await subscribePush({ endpoint: before.endpoint, keys: before.keys }));
    const after = browser();
    const body = JSON.stringify({ oldHash: endpointHash(before.endpoint), endpoint: after.endpoint, keys: after.keys });
    const post = (init: { origin?: string; body?: string }) =>
      renewRoute.POST(new Request("https://pizarro.example.com/api/push/renew", { method: "POST", headers: { ...(init.origin ? { origin: init.origin } : {}), host: "pizarro.example.com", "content-type": "application/json", "user-agent": "pizarro-db-tests" }, body: init.body ?? body }));
    // Sin origen o de otro: 403.
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ origin: "https://pizarro.example.com", body: "{" })).status, 400);
    assert.equal((await post({ origin: "https://pizarro.example.com", body: JSON.stringify({ oldHash: "0".repeat(64), endpoint: after.endpoint, keys: after.keys }) })).status, 404);
    assert.equal((await db.pushSubscription.findFirstOrThrow({ where: { userId: ana.id } })).endpointHash, endpointHash(before.endpoint));
    assert.equal((await post({ origin: "https://pizarro.example.com" })).status, 200);
    assert.equal((await db.pushSubscription.findFirstOrThrow({ where: { userId: ana.id } })).endpointHash, endpointHash(after.endpoint));
    // La clave pública, para suscribirse desde el service worker.
    const key = await (await renewRoute.GET()).json();
    assert.equal(key.publicKey, (await vapidKeys()).publicKey);
    // Sin sesión: 401 (también la clave).
    logout();
    assert.equal((await post({ origin: "https://pizarro.example.com" })).status, 401);
    assert.equal((await renewRoute.GET()).status, 401);
  });
});

describe("avisos push: revisión (clave nueva, paralelo, sesiones, cambio de cuenta)", () => {
  test("si la clave VAPID no se puede descifrar, se crea otra y se borran todas las suscripciones (y lo dice Logs)", async () => {
    const ana = await makeUser();
    expectOk(await subscribe(ana, browser()));
    expectOk(await subscribe(ana, browser()));
    const before = await vapidKeys();
    const total = await db.pushSubscription.count();
    // Como si ENCRYPTION_KEY hubiera cambiado sin la anterior: el valor guardado ya no se abre.
    await db.appState.update({ where: { key: PUSH_VAPID_KEY }, data: { value: "v1.ilegible" } });
    forgetVapidKeys();
    const after = await vapidKeys();
    assert.notEqual(after.publicKey, before.publicKey);
    assert.equal(await db.pushSubscription.count(), 0);
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "push.vapidReset" }, orderBy: { createdAt: "desc" } });
    assert.equal((log.details as { removed: number }).removed, total);
    // La página ya da la clave nueva y suscribir vuelve a funcionar.
    assert.equal(expectOk(await asUser(ana, () => pushSetup())).publicKey, after.publicKey);
    expectOk(await subscribe(ana, browser()));
  });

  test("una suscripción hecha con otra clave VAPID no recibe nada y se quita; las demás, sí", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const f = await makeProject({ members: [ana, bea] });
    const task = await makeTask(f);
    const old = browser();
    const ok = browser();
    const { id } = expectOk(await subscribe(bea, old));
    expectOk(await subscribe(bea, ok));
    await db.pushSubscription.update({ where: { id }, data: { vapidPublicKey: "otra-clave" } });
    await notifyTask({ type: "ASSIGNED", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: task.title, immediate: true });
    assert.equal(received(old).length, 0);
    assert.equal(received(ok).length, 1);
    assert.equal(await db.pushSubscription.count({ where: { id } }), 0);
  });

  test("tiempo máximo y en paralelo: un servicio colgado corta a los 5 s sin frenar a los demás dispositivos", async () => {
    assert.equal(PUSH_TIMEOUT_MS, 5_000);
    const ana = await makeUser();
    const bea = await makeUser();
    const f = await makeProject({ members: [ana, bea] });
    const task = await makeTask(f);
    const slow1 = browser();
    const slow2 = browser("web.push.apple.com");
    const fast = browser("updates.push.services.mozilla.com");
    for (const b of [slow1, slow2, fast]) expectOk(await subscribe(bea, b));
    statusFor[slow1.path] = 0;
    statusFor[slow2.path] = 0;
    await notifyTask({ type: "ASSIGNED", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: task.title, immediate: true });
    assert.equal(received(fast).length, 1);
    const hung = server.hits.filter((h) => h.path === slow1.path || h.path === slow2.path);
    assert.equal(hung.length, 2);
    // Los dos colgados salieron a la vez (en serie, el segundo habría esperado al tiempo máximo del primero).
    assert.ok(Math.abs(hung[0]!.at - hung[1]!.at) < PUSH_TIMEOUT_MS / 2, "en paralelo");
    const n = await db.notification.findFirstOrThrow({ where: { userId: bea.id, taskId: task.id } });
    assert.match(n.deliveryError ?? "", /push: timeout, timeout/);
    assert.ok(n.pushSentAt, "el que respondió cuenta como enviado");
    // Un tiempo agotado no borra la suscripción.
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 3);
  });

  test("cerrar una sesión corta los avisos de ese dispositivo («Cerrar las demás», cerrar una, caducada)", async () => {
    const ana = await makeUser();
    const bea = await makeUser();
    const f = await makeProject({ members: [ana, bea] });
    const phone = browser();
    const laptop = browser("web.push.apple.com");
    const tablet = browser("updates.push.services.mozilla.com");
    // Tres sesiones de Bea, cada una con su navegador.
    await loginAs(bea);
    expectOk(await subscribePush({ endpoint: phone.endpoint, keys: phone.keys }));
    const phoneSession = (await currentSessionId())!;
    await loginAs(bea);
    expectOk(await subscribePush({ endpoint: tablet.endpoint, keys: tablet.keys }));
    const tabletSession = (await currentSessionId())!;
    await loginAs(bea);
    expectOk(await subscribePush({ endpoint: laptop.endpoint, keys: laptop.keys }));
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 3);
    // Desde el portátil cierra la del móvil: sus avisos se cortan.
    expectOk(await revokeSession(phoneSession));
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id, sessionId: phoneSession } }), 0);
    // La de la tableta caduca sola (aún sin borrar): no se le envía y se quita.
    await db.session.update({ where: { id: tabletSession }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const task = await makeTask(f);
    await notifyTask({ type: "ASSIGNED", actorId: ana.id, taskId: task.id, projectId: f.project.id, recipientIds: [bea.id], excerpt: task.title, immediate: true });
    assert.equal(received(tablet).length, 0);
    assert.equal(received(laptop).length, 1);
    assert.equal(received(phone).length, 0);
    assert.equal(await db.pushSubscription.count({ where: { sessionId: tabletSession } }), 0);
    // Otra sesión nueva con su navegador, y «Cerrar las demás» desde el portátil: solo queda el portátil.
    const other = browser();
    await asUser(bea, () => subscribePush({ endpoint: other.endpoint, keys: other.keys }));
    assert.equal(await db.pushSubscription.count({ where: { userId: bea.id } }), 2);
    await loginAs(bea);
    expectOk(await subscribePush({ endpoint: laptop.endpoint, keys: laptop.keys }));
    expectOk(await revokeOtherSessions());
    const left = await db.pushSubscription.findMany({ where: { userId: bea.id }, select: { endpointHash: true } });
    assert.equal(left.length, 1);
  });

  test("el endpoint de otra persona con claves inventadas no le quita su dispositivo", async () => {
    const ana = await makeUser();
    const mallory = await makeUser();
    const b = browser();
    expectOk(await subscribe(ana, b));
    const fake = fakeBrowser();
    expectFail(await subscribe(mallory, { endpoint: b.endpoint, keys: fake.keys }), /no válida/);
    assert.equal(await db.pushSubscription.count({ where: { userId: ana.id } }), 1);
    assert.equal(await db.pushSubscription.count({ where: { userId: mallory.id } }), 0);
    // Con las mismas claves (el mismo navegador, otra cuenta), sí pasa.
    expectOk(await subscribe(mallory, b));
    assert.equal(await db.pushSubscription.count({ where: { userId: mallory.id } }), 1);
  });
});
