// Avisos por Telegram y WhatsApp contra PostgreSQL real, con fetch simulado (nunca se llama a Telegram ni a Meta):
// configuración cifrada, webhook con secreto, enlace con código de un solo uso, envío según preferencias, tope por
// persona, desconexión por 403 y que nada salga hacia quien ya no ve el proyecto.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser } from "./helpers";

process.env.APP_URL = "https://pizarro.example.com";

const { confirmMyWhatsapp, connectTelegram, disconnectChannel, resendMyWhatsappCode, saveChannelPrefs, saveMyWhatsapp, saveTelegramBot, saveWhatsappSettings, setWhatsappActive, testMyChannel, testWhatsapp } = await import("../../src/actions/messaging");
const { POST: webhook } = await import("../../src/app/api/telegram/webhook/route");
const { decryptSecret } = await import("../../src/lib/crypto");
const { getMessagingAdminView, getMyChannels } = await import("../../src/lib/messaging");
const { loadMessagingConfig, reloadMessagingConfig, saveTelegramToken, setTelegramEnabled } = await import("../../src/lib/messaging-config");
const { deliver } = await import("../../src/lib/notify");
const { createTelegramLinkCode, syncTelegram, telegramStatus } = await import("../../src/lib/telegram");
const { resetShutdownForTests, runShutdown } = await import("../../src/lib/shutdown");
const { collectTechInfo } = await import("../../src/lib/tech-info");
const { flushLogs } = await import("../../src/lib/log");
const { telegramWaitState } = await import("../../src/lib/telegram-wait");

const TOKEN = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";
const WA_TOKEN = "EAAGwhatsappTokenDePrueba1234567890";

interface Call { url: string; body: Record<string, unknown> & { chat_id?: string; text?: string } }
let calls: Call[] = [];
/** Respuesta simulada por método (sendMessage, getMe…) o por «graph» para Meta. */
let replies: Record<string, (call: Call) => Response | Promise<Response>> = {};
const realFetch = globalThis.fetch;
const ok = (result: unknown) => () => new Response(JSON.stringify({ ok: true, result }));

beforeEach(() => {
  calls = [];
  replies = {
    getMe: ok({ id: 42, is_bot: true, username: "pizarro_test_bot", first_name: "Pizarro" }),
    setWebhook: ok(true),
    deleteWebhook: ok(true),
    sendMessage: ok({ message_id: 1 }),
    graph: () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] })),
  };
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const call = { url, body };
    calls.push(call);
    if (url.startsWith("https://graph.facebook.com/")) return replies.graph!(call);
    const method = url.split("/").pop()!;
    const reply = replies[method];
    if (!url.startsWith("https://api.telegram.org/") || !reply) throw new Error(`fetch inesperado: ${url}`);
    return reply(call);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function cleanConfig() {
  await db.appState.deleteMany({ where: { OR: [{ key: { startsWith: "telegram." } }, { key: { startsWith: "whatsapp." } }] } });
  await db.userChannel.deleteMany({});
  await reloadMessagingConfig();
}
after(cleanConfig);

async function telegramOn() {
  await saveTelegramToken(TOKEN, { username: "pizarro_test_bot", id: "42" });
  await setTelegramEnabled(true);
  return (await loadMessagingConfig({ fresh: true })).telegram;
}

async function whatsappOn() {
  await db.appState.deleteMany({ where: { key: { startsWith: "whatsapp." } } });
  const admin = await makeUser({ role: "ADMIN" });
  await loginAs(admin);
  expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "en", token: WA_TOKEN }));
  // Guardar la primera vez no lo activa (es de pago): hay que pulsar «Activar».
  expectOk(await setWhatsappActive(true));
}

const sends = (chatId?: string) => calls.filter((c) => c.url.endsWith("/sendMessage") && (!chatId || c.body.chat_id === chatId));
const graphCalls = () => calls.filter((c) => c.url.includes("graph.facebook.com"));
/** El código de 6 cifras del último WhatsApp enviado (va en la variable {{1}} de la plantilla). */
/** Código del último envío con la plantilla de verificación (codigo_pizarro): va en el cuerpo y en el botón. */
function lastWhatsappCode(): string {
  const body = graphCalls().at(-1)?.body as { template?: { name: string; components: { parameters: { text: string }[] }[] } } | undefined;
  assert.equal(body?.template?.name, "codigo_pizarro", "el código sale con la plantilla de autenticación");
  const text = body?.template?.components[0]?.parameters[0]?.text ?? "";
  assert.match(text, /^\d{6}$/, `sin código en «${text}»`);
  return text;
}
const update = (text: string, chatId = 5550001, extra: Record<string, unknown> = {}) => ({ update_id: Math.floor(Math.random() * 1e9), message: { text, chat: { id: chatId, type: "private" }, from: { username: "ana_tg", language_code: "es" }, ...extra } });
const post = (body: unknown, secret: string, headers: Record<string, string> = {}) =>
  webhook(new Request("https://pizarro.example.com/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

async function notice(type: "MENTION" | "ASSIGNED" | "COMMENT", f: { userId: string; taskId: string; actorId?: string }) {
  return (await db.notification.create({ data: { type, userId: f.userId, taskId: f.taskId, actorId: f.actorId ?? null, excerpt: "hola" } })).id;
}

describe("Telegram: configuración", () => {
  test("solo administradores", async () => {
    await cleanConfig();
    await loginAs(await makeUser());
    expectFail(await saveTelegramBot({ token: TOKEN }), FORBIDDEN);
    expectFail(await saveWhatsappSettings({ phoneNumberId: "", templateName: "", templateLang: "", templateLangEn: "" }), FORBIDDEN);
    expectFail(await testWhatsapp({ to: "+34600111222" }), FORBIDDEN);
  });

  test("guarda el token cifrado, nunca lo devuelve y registra el webhook con secreto sobre APP_URL", async () => {
    await cleanConfig();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectFail(await saveTelegramBot({ token: "no-es-un-token" }), /formato/);
    const res = expectOk(await saveTelegramBot({ token: TOKEN }));
    assert.equal(res.bot, "pizarro_test_bot");
    assert.equal(res.mode, "webhook");
    assert.equal(res.error, null);
    assert.equal(JSON.stringify(res).includes(TOKEN), false);
    const stored = await db.appState.findUnique({ where: { key: "telegram.tokenEnc" } });
    assert.ok(stored && stored.value.startsWith("v2.") && !stored.value.includes(TOKEN));
    assert.equal(decryptSecret(stored.value), TOKEN);
    const hook = calls.find((c) => c.url.endsWith("/setWebhook"))!;
    assert.equal(hook.body.url, "https://pizarro.example.com/api/telegram/webhook");
    const secret = (await loadMessagingConfig({ fresh: true })).telegram.webhookSecret;
    assert.ok(secret.length >= 32 && hook.body.secret_token === secret);
    const view = await getMessagingAdminView();
    assert.equal(JSON.stringify(view).includes(TOKEN), false);
    assert.equal(JSON.stringify(view).includes(secret), false);
    assert.equal(view.telegram.tokenLast4, TOKEN.slice(-4));
    assert.equal(view.telegram.active, true);
    // Telegram rechaza el token: se explica y no se guarda nada nuevo.
    replies.getMe = () => new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
    expectFail(await saveTelegramBot({ token: "987654321:BBHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0" }), /Telegram no acepta este token.*401/);
    // El registro de actividad no lleva el token.
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: { startsWith: "settings." } }, select: { message: true, details: true } });
    assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  });

  test("la lectura «fresh» ve lo que otro proceso cambió en la BD (la normal usa la copia de 30 s)", async () => {
    await cleanConfig();
    await telegramOn();
    await db.appState.deleteMany({ where: { key: { startsWith: "telegram." } } });
    assert.equal((await loadMessagingConfig()).telegram.active, true, "copia en memoria");
    assert.equal((await loadMessagingConfig({ fresh: true })).telegram.active, false);
  });
});

describe("Telegram: webhook y enlace con código", () => {
  test("secreto incorrecto → 401; correcto + /start <código> enlaza y confirma; el código no se puede reutilizar", async () => {
    await cleanConfig();
    const cfg = await telegramOn();
    const user = await makeUser({ name: "Ana" });
    const { code } = await createTelegramLinkCode(user.id);
    // Solo se guarda el HMAC del código.
    assert.equal(await db.telegramLinkCode.count({ where: { hash: code } }), 0);
    assert.equal(await db.telegramLinkCode.count({ where: { userId: user.id } }), 1);

    assert.equal((await post(update(`/start ${code}`), "secreto-falso")).status, 401);
    assert.equal((await post(update(`/start ${code}`), "")).status, 401);
    assert.equal(await db.userChannel.count({ where: { userId: user.id } }), 0);

    assert.equal((await post(update(`/start ${code}`), cfg.webhookSecret)).status, 200);
    const ch = await db.userChannel.findUniqueOrThrow({ where: { userId_channel: { userId: user.id, channel: "TELEGRAM" } } });
    assert.equal(ch.address, "5550001");
    assert.equal(ch.label, "@ana_tg");
    assert.deepEqual([ch.notifyMention, ch.notifyAssigned, ch.notifyComment, ch.notifyDue], [true, true, false, false]);
    assert.match(String(sends("5550001")[0]?.body.text), /Listo, Ana/);

    // Otro chat con el mismo código: ya está gastado.
    calls = [];
    assert.equal((await post(update(`/start ${code}`, 5550002), cfg.webhookSecret)).status, 200);
    assert.equal(await db.userChannel.count({ where: { address: "5550002" } }), 0);
    assert.match(String(sends("5550002")[0]?.body.text), /caducado o ya se ha usado/);
  });

  test("código caducado no enlaza; cuerpo demasiado grande → 413; JSON roto → 400", async () => {
    await cleanConfig();
    const cfg = await telegramOn();
    const user = await makeUser();
    const { code } = await createTelegramLinkCode(user.id, new Date(Date.now() - 11 * 60_000));
    assert.equal((await post(update(`/start ${code}`, 5550003), cfg.webhookSecret)).status, 200);
    assert.equal(await db.userChannel.count({ where: { userId: user.id } }), 0);
    assert.equal((await post("x".repeat(70_000), cfg.webhookSecret)).status, 413);
    assert.equal((await post("{roto", cfg.webhookSecret)).status, 400);
  });

  test("/stop y bloquear el bot desconectan", async () => {
    await cleanConfig();
    const cfg = await telegramOn();
    const a = await makeUser();
    const b = await makeUser();
    await db.userChannel.createMany({ data: [{ userId: a.id, channel: "TELEGRAM", address: "6660001" }, { userId: b.id, channel: "TELEGRAM", address: "6660002" }] });
    await post(update("/stop", 6660001), cfg.webhookSecret);
    assert.equal(await db.userChannel.count({ where: { userId: a.id } }), 0);
    assert.match(String(sends("6660001")[0]?.body.text), /ya no recibirás/);
    await post({ update_id: 9, my_chat_member: { chat: { id: 6660002, type: "private" }, new_chat_member: { status: "kicked" } } }, cfg.webhookSecret);
    assert.equal(await db.userChannel.count({ where: { userId: b.id } }), 0);
  });

  test("Conectar Telegram da un enlace t.me de un solo uso (y anula el anterior)", async () => {
    await cleanConfig();
    await telegramOn();
    const user = await makeUser();
    await loginAs(user);
    const first = expectOk(await connectTelegram());
    const second = expectOk(await connectTelegram());
    assert.match(second.url, /^https:\/\/t\.me\/pizarro_test_bot\?start=[A-Za-z0-9_-]{20,}$/);
    assert.ok(second.qr.startsWith("data:image/svg+xml;base64,"));
    assert.notEqual(first.url, second.url);
    assert.equal(await db.telegramLinkCode.count({ where: { userId: user.id } }), 1);
  });

  test("«Esperando a que pulses Iniciar» se corta si el enlace deja de valer (otro enlace u otro bot)", async () => {
    await cleanConfig();
    await telegramOn();
    const user = await makeUser();
    await loginAs(user);
    const first = expectOk(await connectTelegram());
    assert.equal(first.bot, "pizarro_test_bot");
    assert.equal((await getMyChannels(user.id)).telegram?.linkExpiresAt, first.expiresAt);
    assert.equal(telegramWaitState(first, (await getMyChannels(user.id)).telegram), "waiting");
    // Otra pestaña pide otro enlace: el primero ya no vale.
    const second = expectOk(await connectTelegram());
    assert.equal(telegramWaitState(first, (await getMyChannels(user.id)).telegram), "stale");
    assert.equal(telegramWaitState(second, (await getMyChannels(user.id)).telegram), "waiting");
    // «Cambiar de bot»: se borran los enlaces pendientes y el bot es otro.
    replies.getMe = ok({ id: 43, is_bot: true, username: "otro_test_bot", first_name: "Otro" });
    await loginAs(await makeUser({ role: "ADMIN" }));
    expectOk(await saveTelegramBot({ token: TOKEN2 }));
    const after = (await getMyChannels(user.id)).telegram;
    assert.deepEqual([after?.botUsername, after?.linkExpiresAt], ["otro_test_bot", null]);
    assert.equal(telegramWaitState(second, after), "botChanged");
  });
});

describe("envío por Telegram y WhatsApp", () => {
  test("según las preferencias de cada canal; WhatsApp solo con el número confirmado; en el idioma de la persona", async () => {
    await cleanConfig();
    await telegramOn();
    await whatsappOn();
    const user = await makeUser({ name: "Bea" });
    await db.user.update({ where: { id: user.id }, data: { locale: "EN", notifyEmail: false } });
    const actor = await makeUser({ name: "Carlos" });
    const f = await makeProject({ members: [user, actor] });
    const task = await makeTask(f, { title: "Pantalla" });
    await db.userChannel.create({ data: { userId: user.id, channel: "TELEGRAM", address: "7770001" } });
    await db.userChannel.create({ data: { userId: user.id, channel: "WHATSAPP", address: "+34600111222", consentAt: new Date() } });

    const mention = await notice("MENTION", { userId: user.id, taskId: task.id, actorId: actor.id });
    const comment = await notice("COMMENT", { userId: user.id, taskId: task.id, actorId: actor.id });
    await deliver([mention, comment]);
    const tg = sends("7770001");
    assert.equal(tg.length, 1, "por defecto, los comentarios no salen por Telegram");
    assert.match(String(tg[0]!.body.text), /Carlos mentioned you in “Pantalla”/);
    assert.ok(String(tg[0]!.body.text).includes(`https://pizarro.example.com/p/${f.project.id}?task=${task.id}`));
    assert.equal(calls.filter((c) => c.url.includes("graph.facebook.com")).length, 0, "WhatsApp sin confirmar no envía");
    const row = await db.notification.findUniqueOrThrow({ where: { id: mention } });
    assert.ok(row.telegramSentAt);
    assert.equal(row.whatsappSentAt, null);

    // Confirmado: sale por WhatsApp con la plantilla y el idioma inglés.
    await db.userChannel.updateMany({ where: { userId: user.id, channel: "WHATSAPP" }, data: { verifiedAt: new Date() } });
    calls = [];
    const assigned = await notice("ASSIGNED", { userId: user.id, taskId: task.id, actorId: actor.id });
    await deliver([assigned]);
    const wa = calls.find((c) => c.url === "https://graph.facebook.com/v23.0/1234567890/messages")!;
    assert.ok(wa, "envío a la Cloud API");
    const template = wa.body.template as { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
    assert.equal(wa.body.to, "34600111222");
    assert.equal(template.name, "aviso_pizarro");
    assert.equal(template.language.code, "en");
    assert.match(template.components[0]!.parameters[0]!.text, /^Carlos assigned “Pantalla” to you$/);
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: assigned } })).whatsappSentAt);

    // Quitar los comentarios de Telegram también los quita; activarlos los envía.
    await loginAs(user);
    expectOk(await saveChannelPrefs("TELEGRAM", { notifyMention: false, notifyAssigned: false, notifyDue: false, notifyComment: true }));
    calls = [];
    await deliver([await notice("MENTION", { userId: user.id, taskId: task.id }), await notice("COMMENT", { userId: user.id, taskId: task.id })]);
    assert.equal(sends("7770001").length, 1);
    assert.match(String(sends("7770001")[0]!.body.text), /commented/);
  });

  test("tope por persona: como mucho 30 mensajes de Telegram por hora", async () => {
    await cleanConfig();
    await telegramOn();
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { notifyEmail: false } });
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await db.userChannel.create({ data: { userId: user.id, channel: "TELEGRAM", address: "8880001" } });
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) ids.push(await notice("MENTION", { userId: user.id, taskId: task.id }));
    await deliver(ids);
    assert.equal(sends("8880001").length, 30);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "notify.telegramRateLimited", userId: user.id } }), 1, "se avisa una vez, no por cada mensaje");
  });

  test("403 al enviar (bot bloqueado): desconecta el canal y lo registra sin el token", async () => {
    await cleanConfig();
    await telegramOn();
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await db.userChannel.create({ data: { userId: user.id, channel: "TELEGRAM", address: "9990001" } });
    replies.sendMessage = () => new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
    const id = await notice("MENTION", { userId: user.id, taskId: task.id });
    await deliver([id]);
    assert.equal(sends("9990001").length, 1, "un 403 no se reintenta");
    assert.equal(await db.userChannel.count({ where: { userId: user.id } }), 0);
    const n = await db.notification.findUniqueOrThrow({ where: { id } });
    assert.equal(n.telegramSentAt, null);
    assert.match(n.deliveryError ?? "", /telegram: Telegram 403/);
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { userId: user.id, action: { in: ["notify.telegramFailed", "notify.telegramDisconnected"] } }, select: { action: true, message: true } });
    assert.deepEqual(logs.map((l) => l.action).sort(), ["notify.telegramDisconnected", "notify.telegramFailed"]);
    assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  });

  test("nada sale por fuera hacia quien ya no ve el proyecto privado", async () => {
    await cleanConfig();
    await telegramOn();
    const owner = await makeUser();
    const member = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [member] });
    const task = await makeTask(f, { title: "Secreto" });
    await db.userChannel.create({ data: { userId: member.id, channel: "TELEGRAM", address: "1110001" } });
    const id = await notice("MENTION", { userId: member.id, taskId: task.id, actorId: owner.id });
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: member.id } });
    await deliver([id]);
    assert.equal(sends("1110001").length, 0);
  });

  test("WhatsApp en Mi perfil: exige consentimiento, envía un código y queda pendiente hasta escribirlo", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    await loginAs(user);
    expectFail(await saveMyWhatsapp({ phone: "+34600999888", consent: false }), /Marca la casilla/);
    expectFail(await saveMyWhatsapp({ phone: "600999888", consent: true }), /formato internacional/);
    calls = [];
    const res = expectOk(await saveMyWhatsapp({ phone: "+34 600 99 98 88", consent: true }));
    assert.deepEqual(res, { verified: false, sent: true });
    assert.equal(calls.filter((c) => c.url.includes("graph.facebook.com")).length, 1);
    let ch = await db.userChannel.findUniqueOrThrow({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } } });
    assert.equal(ch.address, "+34600999888");
    assert.ok(ch.consentAt);
    assert.equal(ch.verifiedAt, null);
    expectFail(await confirmMyWhatsapp({ code: "" }), /código de 6 cifras/);
    expectOk(await confirmMyWhatsapp({ code: lastWhatsappCode() }));
    ch = await db.userChannel.findUniqueOrThrow({ where: { id: ch.id } });
    assert.ok(ch.verifiedAt);
    // El registro de actividad no lleva el número completo.
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { userId: user.id }, select: { message: true, details: true } });
    assert.equal(JSON.stringify(logs).includes("600999888"), false);
    expectOk(await disconnectChannel("WHATSAPP"));
    assert.equal(await db.userChannel.count({ where: { userId: user.id } }), 0);
  });

  test("WhatsApp desactivado por el administrador: no se envía aunque la persona esté conectada", async () => {
    await cleanConfig();
    await whatsappOn();
    expectOk(await setWhatsappActive(false));
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await db.userChannel.create({ data: { userId: user.id, channel: "WHATSAPP", address: "+34600111333", consentAt: new Date(), verifiedAt: new Date() } });
    calls = [];
    await deliver([await notice("MENTION", { userId: user.id, taskId: task.id })]);
    assert.equal(calls.filter((c) => c.url.includes("graph.facebook.com")).length, 0);
  });
});

// --- Revisión: respuestas escapadas, sondeo por bot, reintentos de syncTelegram y apagado ---

const TOKEN2 = "987654321:CCHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T1";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("tiempo agotado esperando la condición");
    await pause(10);
  }
}
const updatesFor = (token: string) => calls.filter((c) => c.url === `https://api.telegram.org/bot${token}/getUpdates`);
const pollState = () => (globalThis as unknown as { __pizarroTelegram: { retryBaseMs: number } }).__pizarroTelegram;

describe("Telegram: respuestas del bot", () => {
  test("el nombre de la persona va escapado (parse_mode HTML): ni rompe el mensaje ni cuela etiquetas", async () => {
    await cleanConfig();
    const cfg = await telegramOn();
    const user = await makeUser({ name: "Ana & <b>Bea</b> <a href=\"https://evil.example.com\">x</a>" });
    const { code } = await createTelegramLinkCode(user.id);
    assert.equal((await post(update(`/start ${code}`, 5550009), cfg.webhookSecret)).status, 200);
    const sent = sends("5550009")[0]!;
    const text = String(sent.body.text);
    assert.equal((sent.body as { parse_mode?: string }).parse_mode, "HTML");
    assert.ok(text.includes("Listo, Ana &amp; &lt;b&gt;Bea&lt;/b&gt; &lt;a href=&quot;https://evil.example.com&quot;&gt;"), text);
    assert.ok(!/<[a-z]/i.test(text), "ninguna etiqueta sin escapar");
  });
});

describe("Telegram: sondeo (sin webhook)", () => {
  const appUrl = process.env.APP_URL;
  afterEach(async () => {
    process.env.APP_URL = appUrl;
    // Ningún bucle debe seguir preguntando a Telegram (con el fetch real) después de la prueba.
    await setTelegramEnabled(false);
    await syncTelegram();
  });
  /** getUpdates simulado: el primer lote de cada token trae `first`; después, una espera corta sin nada. */
  function fakeUpdates(first: Record<string, unknown[]>) {
    const served = new Set<string>();
    replies.getUpdates = (c) => {
      const token = Object.keys(first).find((k) => c.url.includes(k)) ?? "";
      const batch = token && !served.has(token) ? (served.add(token), first[token]!) : null;
      return new Promise((r) => setTimeout(() => r(new Response(JSON.stringify({ ok: true, result: batch ?? [] }))), batch ? 0 : 30));
    };
  }

  test("otro bot: el sondeo se reinicia con el token nuevo y su propio offset; se quita el webhook del anterior y cambia el secreto", async () => {
    await cleanConfig();
    process.env.APP_URL = "http://pizarro.local:3000";
    await loginAs(await makeUser({ role: "ADMIN" }));
    fakeUpdates({ [TOKEN]: [{ update_id: 1000, message: { text: "/help", chat: { id: 5551, type: "private" }, from: { language_code: "es" } } }], [TOKEN2]: [] });
    replies.getMe = (c) => new Response(JSON.stringify({ ok: true, result: c.url.includes(TOKEN2) ? { id: 43, is_bot: true, username: "otro_test_bot" } : { id: 42, is_bot: true, username: "pizarro_test_bot" } }));
    assert.equal(expectOk(await saveTelegramBot({ token: TOKEN })).mode, "polling");
    await waitFor(() => updatesFor(TOKEN).some((c) => c.body.offset === 1001));
    const secret1 = (await loadMessagingConfig({ fresh: true })).telegram.webhookSecret;

    const mark = calls.length;
    expectOk(await saveTelegramBot({ token: TOKEN2 }));
    assert.ok(calls.slice(mark).some((c) => c.url === `https://api.telegram.org/bot${TOKEN}/deleteWebhook`), "el bot anterior deja de llamar a Pizarro");
    await waitFor(() => updatesFor(TOKEN2).length > 0);
    assert.equal(updatesFor(TOKEN2)[0]!.body.offset, undefined, "el bot nuevo empieza desde su primera actualización");
    const secret2 = (await loadMessagingConfig({ fresh: true })).telegram.webhookSecret;
    assert.ok(secret2.length >= 32 && secret2 !== secret1, "secreto del webhook nuevo");
    // El bucle viejo no sigue preguntando con el token anterior.
    const old = updatesFor(TOKEN).length;
    await pause(150);
    assert.equal(updatesFor(TOKEN).length, old);
  });

  test("al apagar, confirma a Telegram el último lote (getUpdates con su offset y sin espera)", async () => {
    await cleanConfig();
    process.env.APP_URL = "http://pizarro.local:3000";
    await loginAs(await makeUser({ role: "ADMIN" }));
    fakeUpdates({ [TOKEN]: [{ update_id: 2000, message: { text: "/help", chat: { id: 5552, type: "private" }, from: { language_code: "es" } } }] });
    expectOk(await saveTelegramBot({ token: TOKEN }));
    await waitFor(() => updatesFor(TOKEN).some((c) => c.body.offset === 2001));
    const mark = calls.length;
    try {
      await runShutdown("SIGTERM", { flushLogs: async () => {}, logEvent: () => {}, closeStreams: () => 0, stopListening: async () => ({ closed: 0, drained: async () => 0 }), exit: () => {}, graceMs: 3_000, flushMs: 10 });
      const ack = calls.slice(mark).find((c) => c.url.endsWith("/getUpdates") && c.body.timeout === 0);
      assert.ok(ack, "confirma el último lote antes de salir");
      assert.equal(ack.body.offset, 2001);
      assert.equal(telegramStatus().polling, false);
    } finally {
      resetShutdownForTests();
    }
  });
});

describe("Telegram: reintentos al preparar el bot", () => {
  test("si Telegram falla al registrar el webhook, syncTelegram se reintenta solo hasta que sale bien", async () => {
    await cleanConfig();
    pollState().retryBaseMs = 20;
    try {
      let failures = 2;
      replies.setWebhook = () => (failures-- > 0 ? new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), { status: 502 }) : new Response(JSON.stringify({ ok: true, result: true })));
      await telegramOn();
      const first = await syncTelegram();
      assert.match(first.error ?? "", /502/);
      assert.ok(telegramStatus().retryAt > 0, "queda un reintento programado");
      await waitFor(() => telegramStatus().lastError === null);
      assert.equal(calls.filter((c) => c.url.endsWith("/setWebhook")).length, 3);
      assert.equal(telegramStatus().retryAt, 0, "sin más reintentos tras salir bien");
    } finally {
      pollState().retryBaseMs = 5_000;
    }
  });
});

describe("WhatsApp: código de verificación y topes", () => {
  const save = (phone: string) => saveMyWhatsapp({ phone, consent: true });
  const channel = (userId: string) => db.userChannel.findUniqueOrThrow({ where: { userId_channel: { userId, channel: "WHATSAPP" } } });

  test("el código va en la plantilla, solo se guarda su HMAC y hay que escribirlo bien; sin él no se confirma", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    await loginAs(user);
    calls = [];
    expectOk(await save("+34611000001"));
    const code = lastWhatsappCode();
    // Cuerpo exacto que recibe Meta: plantilla de autenticación con el código en el cuerpo y en el botón «Copiar código».
    assert.equal(graphCalls().length, 1);
    assert.equal(graphCalls()[0]!.url, "https://graph.facebook.com/v23.0/1234567890/messages");
    assert.deepEqual(graphCalls()[0]!.body, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "34611000001",
      type: "template",
      template: {
        name: "codigo_pizarro",
        language: { code: "es" },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    });
    const row = await channel(user.id);
    assert.ok(row.verifyCodeHash && !row.verifyCodeHash.includes(code));
    assert.ok(row.verifyExpiresAt && row.verifyExpiresAt.getTime() - Date.now() > 14 * 60_000 && row.verifyExpiresAt.getTime() - Date.now() <= 15 * 60_000);
    const wrong = code === "000000" ? "111111" : "000000";
    expectFail(await confirmMyWhatsapp({ code: wrong }), /no es correcto\. Te quedan 4 intentos/);
    assert.equal((await channel(user.id)).verifiedAt, null);
    // Un aviso no sale mientras no se confirme; la prueba desde Mi perfil tampoco.
    expectFail(await testMyChannel("WHATSAPP"), /Confirma primero tu número/);
    expectOk(await confirmMyWhatsapp({ code: `${code.slice(0, 3)} ${code.slice(3)}` }));
    const done = await channel(user.id);
    assert.ok(done.verifiedAt);
    assert.equal(done.verifyCodeHash, null);
    // Guardar otra vez el mismo número confirmado no envía nada.
    calls = [];
    assert.deepEqual(expectOk(await save("+34611000001")), { verified: true, sent: false });
    assert.equal(graphCalls().length, 0);
  });

  test("5 intentos como mucho y caducidad de 15 minutos; «Enviar otro código» anula el anterior", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    await loginAs(user);
    expectOk(await save("+34611000002"));
    const code = lastWhatsappCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expectFail(await confirmMyWhatsapp({ code: wrong }), /no es correcto/);
    expectFail(await confirmMyWhatsapp({ code: wrong }), /ya no quedan intentos/);
    // Ni el bueno vale ya.
    expectFail(await confirmMyWhatsapp({ code }), /caducado o ya no vale/);
    assert.equal((await channel(user.id)).verifiedAt, null);

    expectOk(await resendMyWhatsappCode());
    const second = lastWhatsappCode();
    await db.userChannel.updateMany({ where: { userId: user.id }, data: { verifyExpiresAt: new Date(Date.now() - 1_000) } });
    expectFail(await confirmMyWhatsapp({ code: second }), /caducado/);
    expectOk(await resendMyWhatsappCode());
    const third = lastWhatsappCode();
    if (third !== second) expectFail(await confirmMyWhatsapp({ code: second }), /no es correcto/);
    expectOk(await confirmMyWhatsapp({ code: third }));
    assert.ok((await channel(user.id)).verifiedAt);
  });

  test("topes de mensajes de prueba: 3 al día por número (sea quien sea quien los pida) y 5 al día por persona", async () => {
    await cleanConfig();
    await whatsappOn();
    const a = await makeUser();
    const b = await makeUser();
    await loginAs(a);
    expectOk(await save("+34611000003"));
    expectOk(await resendMyWhatsappCode());
    expectOk(await resendMyWhatsappCode());
    calls = [];
    expectFail(await resendMyWhatsappCode(), /máximo de mensajes de WhatsApp de prueba/);
    // Otra persona tampoco puede seguir enviando a ese número.
    await loginAs(b);
    expectFail(await save("+34611000003"), /máximo de mensajes de WhatsApp de prueba/);
    assert.equal(graphCalls().length, 0);
    assert.equal(await db.userChannel.count({ where: { userId: b.id } }), 0, "no se guarda el número si no se puede enviar el código");

    const c = await makeUser();
    await loginAs(c);
    expectOk(await save("+34611000004"));
    expectOk(await resendMyWhatsappCode());
    expectOk(await save("+34611000005"));
    expectOk(await resendMyWhatsappCode());
    expectOk(await save("+34611000006"));
    expectFail(await resendMyWhatsappCode(), /máximo de mensajes de WhatsApp de prueba/);
  });

  test("un 5xx o una conexión cortada de Meta no se reintentan (podría estar enviado y cobrado)", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { notifyEmail: false } });
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await db.userChannel.create({ data: { userId: user.id, channel: "WHATSAPP", address: "+34611000007", consentAt: new Date(), verifiedAt: new Date() } });
    replies.graph = () => new Response(JSON.stringify({ error: { message: "Service Unavailable", code: 1 } }), { status: 503 });
    calls = [];
    const first = await notice("MENTION", { userId: user.id, taskId: task.id });
    await deliver([first]);
    assert.equal(graphCalls().length, 1);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: first } })).whatsappSentAt, null);
    replies.graph = () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET", message: "socket hang up" } });
    };
    calls = [];
    await deliver([await notice("ASSIGNED", { userId: user.id, taskId: task.id })]);
    assert.equal(graphCalls().length, 1);
  });

  test("Mi perfil: un número de una versión anterior sin consentimiento se ve, pero no recibe nada hasta confirmarlo", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await db.userChannel.create({ data: { userId: user.id, channel: "WHATSAPP", address: "+34611000008" } });
    const view = await getMyChannels(user.id);
    assert.deepEqual([view.whatsapp?.phone, view.whatsapp?.consented, view.whatsapp?.verified], ["+34611000008", false, false]);
    calls = [];
    await deliver([await notice("MENTION", { userId: user.id, taskId: task.id })]);
    assert.equal(graphCalls().length, 0);
    const admin = await getMessagingAdminView();
    assert.deepEqual([admin.whatsapp.connected, admin.whatsapp.pending], [0, 0]);
  });
});

describe("WhatsApp: plantilla de verificación (autenticación)", () => {
  const metaError = (code: number, message: string) => () => new Response(JSON.stringify({ error: { message, code, error_data: { details: message } } }), { status: 404 });

  test("se configura en Ajustes (nombre e idioma); los avisos siguen con aviso_pizarro, idénticos", async () => {
    await cleanConfig();
    await whatsappOn();
    expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "en", codeTemplateName: "mi_codigo", codeTemplateLang: "es_ES" }));
    const view = await getMessagingAdminView();
    assert.deepEqual([view.whatsapp.codeTemplateName, view.whatsapp.codeTemplateLang, view.whatsapp.defaultCodeTemplate], ["mi_codigo", "es_ES", "codigo_pizarro"]);
    assert.deepEqual([view.whatsapp.effective.codeTemplateName, view.whatsapp.effective.codeTemplateLang], ["mi_codigo", "es_ES"]);
    expectFail(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "en", codeTemplateName: "Mi Código" }), /minúsculas/);

    // Una persona en inglés: el código va en la plantilla de verificación y su idioma (el texto lo pone Meta).
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { locale: "EN", notifyEmail: false } });
    await loginAs(user);
    calls = [];
    expectOk(await saveMyWhatsapp({ phone: "+34611000020", consent: true }));
    const code = graphCalls()[0]!.body as { template: { name: string; language: { code: string } } };
    assert.deepEqual([code.template.name, code.template.language.code], ["mi_codigo", "es_ES"]);

    // El aviso de siempre: aviso_pizarro, en inglés, solo cuerpo con sus 3 variables.
    await db.userChannel.updateMany({ where: { userId: user.id }, data: { verifiedAt: new Date() } });
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f, { title: "Pantalla" });
    calls = [];
    await deliver([await notice("MENTION", { userId: user.id, taskId: task.id })]);
    assert.equal(graphCalls().length, 1);
    const body = graphCalls()[0]!.body as { recipient_type?: string; template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] } };
    assert.equal(body.template.name, "aviso_pizarro");
    assert.equal(body.template.language.code, "en");
    assert.equal(body.recipient_type, undefined);
    assert.deepEqual(body.template.components.map((c) => [c.type, c.parameters.length]), [["body", 3]]);
    assert.equal(body.template.components[0]!.parameters[2]!.text, `https://pizarro.example.com/p/${f.project.id}?task=${task.id}`);
  });

  test("Meta no tiene la plantilla (132001): error claro, el código no queda pendiente y Ajustes y Mi perfil lo explican", async () => {
    await cleanConfig();
    await whatsappOn();
    const user = await makeUser();
    await loginAs(user);
    replies.graph = metaError(132001, "(#132001) Template name does not exist in the translation");
    calls = [];
    expectFail(await saveMyWhatsapp({ phone: "+34611000021", consent: true }), /el administrador de Pizarro tiene que crear \(o revisar\) en Meta la plantilla de verificación/);
    assert.equal(graphCalls().length, 1, "un error de plantilla no se reintenta");
    const row = await db.userChannel.findUniqueOrThrow({ where: { userId_channel: { userId: user.id, channel: "WHATSAPP" } } });
    assert.deepEqual([row.verifiedAt, row.verifyCodeHash, row.verifyExpiresAt], [null, null, null], "no se dice «te hemos enviado un código»");
    const mine = await getMyChannels(user.id);
    assert.deepEqual([mine.whatsapp?.codePending, mine.whatsapp?.codeBlocked], [false, true]);
    const admin = await getMessagingAdminView();
    assert.deepEqual(admin.whatsapp.codeTemplateError && [admin.whatsapp.codeTemplateError.problem, admin.whatsapp.codeTemplateError.code, admin.whatsapp.codeTemplateError.name], ["missing", 132001, "codigo_pizarro"]);
    await flushLogs();
    assert.equal(JSON.stringify(await db.appLog.findMany({ where: { userId: user.id }, select: { message: true, details: true } })).includes("611000021"), false);

    // El administrador la crea: el siguiente código sale y se olvida el error.
    replies.graph = () => new Response(JSON.stringify({ messages: [{ id: "wamid.2" }] }));
    expectOk(await resendMyWhatsappCode());
    expectOk(await confirmMyWhatsapp({ code: lastWhatsappCode() }));
    assert.equal((await getMessagingAdminView()).whatsapp.codeTemplateError, null);
    assert.equal((await getMyChannels(user.id)).whatsapp?.codeBlocked, false);
  });

  test("«Probar» de Ajustes envía las dos plantillas y dice cuál falla (una de utilidad con ese nombre: 132000)", async () => {
    await cleanConfig();
    await whatsappOn();
    calls = [];
    const both = expectOk(await testWhatsapp({ to: "+34611000022" }));
    assert.deepEqual([both.noticeError, both.codeError], [null, null]);
    assert.deepEqual(graphCalls().map((c) => (c.body.template as { name: string }).name), ["aviso_pizarro", "codigo_pizarro"]);
    assert.deepEqual((graphCalls()[1]!.body.template as { components: unknown[] }).components, [
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);

    replies.graph = (call) => ((call.body.template as { name: string }).name === "codigo_pizarro"
      ? metaError(132000, "(#132000) Number of parameters does not match the expected number of params")()
      : new Response(JSON.stringify({ messages: [{ id: "wamid.3" }] })));
    const one = expectOk(await testWhatsapp({ to: "+34611000022" }));
    assert.equal(one.noticeError, null);
    assert.match(one.codeError ?? "", /plantilla de verificación «codigo_pizarro» no tiene la forma que espera Pizarro \(error 132000\): tiene que ser de categoría Autenticación/);
    assert.equal((await getMessagingAdminView()).whatsapp.codeTemplateError?.problem, "params");

    // Las dos fallan: error de la acción con los dos motivos. Guardar los ajustes olvida el rechazo anterior.
    replies.graph = metaError(132001, "(#132001) Template name does not exist in the translation");
    expectFail(await testWhatsapp({ to: "+34611000022" }), /No se pudo enviar el WhatsApp de prueba\..*no existe en Meta o aún no está aprobada \(error 132001\)/);
    expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "en" }));
    assert.equal((await getMessagingAdminView()).whatsapp.codeTemplateError, null);
  });
});

describe("información técnica", () => {
  test("«Copiar información técnica» refleja Telegram y WhatsApp configurados en Ajustes", async () => {
    await cleanConfig();
    await telegramOn();
    await whatsappOn();
    const line = (await collectTechInfo()).split("\n").find((l) => l.startsWith("Features:")) ?? "";
    assert.match(line, /\btelegram\b/);
    assert.match(line, /\bwhatsapp\b/);
  });
});
