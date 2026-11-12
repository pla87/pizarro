// Telegram y WhatsApp contra PostgreSQL real (con fetch simulado): WhatsApp no se activa solo al guardar y, sin plantilla
// en inglés, va entero en español; «Probar» en Mi perfil → Avisos con el bot bloqueado desconecta como los avisos.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";

process.env.APP_URL = "https://pizarro.example.com";

const { saveMyWhatsapp, saveWhatsappSettings, setWhatsappActive, testMyChannel } = await import("../../src/actions/messaging");
const { invalidateAppSettings, COMMENT_LIMIT_KEY } = await import("../../src/lib/app-settings");
const { loadMessagingConfig, reloadMessagingConfig, saveTelegramToken, setTelegramEnabled } = await import("../../src/lib/messaging-config");
const { deliver } = await import("../../src/lib/notify");

const request = (globalThis as unknown as { __pzTestRequest: { headers?: Record<string, string> } }).__pzTestRequest;
const WA_TOKEN = "EAAGwhatsappTokenDePrueba1234567890";
const TG_TOKEN = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";

interface Call { url: string; body: Record<string, unknown> }
let calls: Call[] = [];
let telegramReply: () => Response = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  telegramReply = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.startsWith("https://graph.facebook.com/")) return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
    if (url.startsWith("https://api.telegram.org/")) return telegramReply();
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  delete request.headers;
  for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k];
  await db.appState.deleteMany({ where: { OR: [{ key: { startsWith: "telegram." } }, { key: { startsWith: "whatsapp." } }, { key: COMMENT_LIMIT_KEY }] } });
  await db.userChannel.deleteMany({});
  await reloadMessagingConfig();
  invalidateAppSettings();
});

type Template = { language: { code: string }; components: { parameters: { text: string }[] }[] };
const lastTemplate = () => calls.filter((c) => c.url.includes("graph.facebook.com")).at(-1)?.body.template as Template | undefined;

describe("WhatsApp: activar", () => {
  test("guardar la primera vez no lo activa; «Activar» sí", async () => {
    await loginAs(await makeUser({ role: "ADMIN" }));
    const res = expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "", token: WA_TOKEN }));
    assert.deepEqual(res, { complete: true, active: false });
    assert.equal((await db.appState.findUnique({ where: { key: "whatsapp.enabled" } }))?.value, "false");
    expectOk(await setWhatsappActive(true));
    // Guardar otra vez no lo toca.
    expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es_ES", templateLangEn: "" }));
    assert.equal((await loadMessagingConfig({ fresh: true })).whatsapp.active, true);
  });

  test("una instalación activa solo con las variables WHATSAPP_* sigue activa al guardar", async () => {
    process.env.WHATSAPP_TOKEN = WA_TOKEN;
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    await reloadMessagingConfig();
    assert.equal((await loadMessagingConfig({ fresh: true })).whatsapp.active, true);
    await loginAs(await makeUser({ role: "ADMIN" }));
    const res = expectOk(await saveWhatsappSettings({ phoneNumberId: "", templateName: "aviso_pizarro", templateLang: "", templateLangEn: "" }));
    assert.equal(res.active, true);
    assert.equal((await db.appState.findUnique({ where: { key: "whatsapp.enabled" } }))?.value, "true");
  });
});

describe("WhatsApp en inglés sin «Idioma en inglés»", () => {
  async function setup(langEn: string) {
    await loginAs(await makeUser({ role: "ADMIN" }));
    expectOk(await saveWhatsappSettings({ phoneNumberId: "1234567890", templateName: "aviso_pizarro", templateLang: "es", templateLangEn: langEn, token: WA_TOKEN }));
    expectOk(await setWhatsappActive(true));
    const user = await makeUser({ name: "Bea" });
    await db.user.update({ where: { id: user.id }, data: { locale: "EN", notifyEmail: false } });
    return user;
  }

  test("el aviso va con la plantilla en español y sus variables también en español", async () => {
    const user = await setup("");
    const actor = await makeUser({ name: "Carlos" });
    const f = await makeProject({ members: [user, actor] });
    const task = await makeTask(f, { title: "Pantalla" });
    await db.userChannel.create({ data: { userId: user.id, channel: "WHATSAPP", address: "+34600111222", consentAt: new Date(), verifiedAt: new Date() } });
    const n = await db.notification.create({ data: { type: "ASSIGNED", userId: user.id, taskId: task.id, actorId: actor.id, excerpt: "" } });
    await deliver([n.id]);
    const tpl = lastTemplate()!;
    assert.equal(tpl.language.code, "es");
    assert.match(tpl.components[0]!.parameters[0]!.text, /^Carlos te ha asignado/);
  });

  test("el código de verificación, igual; con la plantilla en inglés, en inglés", async () => {
    let user = await setup("");
    await loginAs(user);
    expectOk(await saveMyWhatsapp({ phone: "+34600111333", consent: true }));
    let tpl = lastTemplate()!;
    assert.equal(tpl.language.code, "es");
    assert.match(tpl.components[0]!.parameters[0]!.text, /^Tu código de verificación de Pizarro es \d{6}$/);

    await db.appState.deleteMany({ where: { key: { startsWith: "whatsapp." } } });
    user = await setup("en");
    await loginAs(user);
    expectOk(await saveMyWhatsapp({ phone: "+34600111444", consent: true }));
    tpl = lastTemplate()!;
    assert.equal(tpl.language.code, "en");
    assert.match(tpl.components[0]!.parameters[0]!.text, /^Your Pizarro verification code is \d{6}$/);
  });
});

describe("Mi perfil → Avisos → Probar con el bot bloqueado", () => {
  test("Telegram 403: muestra el error y desconecta, como los avisos de verdad", async () => {
    await saveTelegramToken(TG_TOKEN, { username: "pizarro_test_bot", id: "42" });
    await setTelegramEnabled(true);
    const user = await makeUser();
    await db.userChannel.create({ data: { userId: user.id, channel: "TELEGRAM", address: "7770009" } });
    await loginAs(user);
    telegramReply = () => new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
    expectFail(await testMyChannel("TELEGRAM"), /se ha desconectado/);
    assert.equal(await db.userChannel.count({ where: { userId: user.id, channel: "TELEGRAM" } }), 0);
  });

  test("otro error (p. ej. 400 cualquiera) no desconecta", async () => {
    await saveTelegramToken(TG_TOKEN, { username: "pizarro_test_bot", id: "42" });
    await setTelegramEnabled(true);
    const user = await makeUser();
    await db.userChannel.create({ data: { userId: user.id, channel: "TELEGRAM", address: "7770010" } });
    await loginAs(user);
    telegramReply = () => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message is too long" }), { status: 400 });
    expectFail(await testMyChannel("TELEGRAM"), /No se pudo enviar el mensaje de prueba/);
    assert.equal(await db.userChannel.count({ where: { userId: user.id, channel: "TELEGRAM" } }), 1);
  });
});
