// Avisos por Telegram y WhatsApp contra PostgreSQL real, con fetch simulado (nunca se llama a Telegram ni a Meta):
// configuración cifrada, webhook con secreto, enlace con código de un solo uso, envío según preferencias, tope por
// persona, desconexión por 403 y que nada salga hacia quien ya no ve el proyecto.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser } from "./helpers";

process.env.APP_URL = "https://pizarro.example.com";

const { confirmMyWhatsapp, connectTelegram, disconnectChannel, saveChannelPrefs, saveMyWhatsapp, saveTelegramBot, saveWhatsappSettings, setWhatsappActive, testWhatsapp } = await import("../../src/actions/messaging");
const { POST: webhook } = await import("../../src/app/api/telegram/webhook/route");
const { decryptSecret } = await import("../../src/lib/crypto");
const { getMessagingAdminView } = await import("../../src/lib/messaging");
const { loadMessagingConfig, reloadMessagingConfig, saveTelegramToken, setTelegramEnabled } = await import("../../src/lib/messaging-config");
const { deliver } = await import("../../src/lib/notify");
const { createTelegramLinkCode } = await import("../../src/lib/telegram");
const { flushLogs } = await import("../../src/lib/log");

const TOKEN = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";
const WA_TOKEN = "EAAGwhatsappTokenDePrueba1234567890";

interface Call { url: string; body: Record<string, unknown> & { chat_id?: string; text?: string } }
let calls: Call[] = [];
/** Respuesta simulada por método (sendMessage, getMe…) o por «graph» para Meta. */
let replies: Record<string, () => Response> = {};
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
    calls.push({ url, body });
    if (url.startsWith("https://graph.facebook.com/")) return replies.graph!();
    const method = url.split("/").pop()!;
    const reply = replies[method];
    if (!url.startsWith("https://api.telegram.org/") || !reply) throw new Error(`fetch inesperado: ${url}`);
    return reply();
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
}

const sends = (chatId?: string) => calls.filter((c) => c.url.endsWith("/sendMessage") && (!chatId || c.body.chat_id === chatId));
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
    assert.match(String(tg[0]!.body.text), /Carlos mentioned you in «Pantalla»/);
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
    assert.match(template.components[0]!.parameters[0]!.text, /^Carlos assigned «Pantalla» to you$/);
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

  test("WhatsApp en Mi perfil: exige consentimiento, envía un mensaje de prueba y queda pendiente hasta confirmarlo", async () => {
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
    expectOk(await confirmMyWhatsapp());
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
