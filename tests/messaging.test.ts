// Avisos por Telegram y WhatsApp: reglas puras (modo del bot, códigos, preferencias, reintentos, precedencia, textos)
// y la llamada a la API de Telegram con fetch simulado (nunca se llama a Telegram ni a Meta de verdad).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const core = await import("../src/lib/messaging-core");
const { messagingFlags } = await import("../src/lib/doctor-core");
const { makeT } = await import("../src/i18n/core");
const { telegramCall, getBot } = await import("../src/lib/telegram");
const { mentionEmail } = await import("../src/lib/notify");
const { assignedBatchExcerpt } = await import("../src/lib/notification-text");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("modo del bot: webhook solo con https pública en un puerto que Telegram admite", () => {
  assert.deepEqual(core.telegramMode("https://pizarro.example.com/"), { mode: "webhook", webhookUrl: "https://pizarro.example.com/api/telegram/webhook", reason: "ok" });
  assert.equal(core.telegramMode("https://pizarro.example.com:8443").mode, "webhook");
  assert.equal(core.telegramMode("http://pizarro.example.com").reason, "not-https");
  assert.equal(core.telegramMode("https://localhost").reason, "private-host");
  assert.equal(core.telegramMode("https://192.168.1.20").reason, "private-host");
  assert.equal(core.telegramMode("https://pizarro.lan").reason, "private-host");
  assert.equal(core.telegramMode("https://pizarro.example.com:3000").reason, "port");
  assert.equal(core.telegramMode(undefined).reason, "no-app-url");
});

test("/start con código: solo el formato esperado", () => {
  assert.equal(core.parseStartCode("/start abcdefghijklmnop_-12"), "abcdefghijklmnop_-12");
  assert.equal(core.parseStartCode("/start@pizarro_bot abcdefghijklmnop_-12"), "abcdefghijklmnop_-12");
  assert.equal(core.parseStartCode("/start"), null);
  assert.equal(core.parseStartCode("/start corto"), null);
  assert.equal(core.parseStartCode("/start abcdefghijklmnop; drop"), null);
  assert.equal(core.telegramCommand("/STOP"), "stop");
  assert.equal(core.telegramCommand("hola"), null);
  assert.equal(core.telegramStartUrl("pizarro_bot", "abc"), "https://t.me/pizarro_bot?start=abc");
});

test("secreto del webhook: comparación en tiempo constante, también con longitudes distintas", () => {
  assert.equal(core.safeEqual("secreto-largo-123", "secreto-largo-123"), true);
  assert.equal(core.safeEqual("secreto-largo-123", "secreto-largo-124"), false);
  assert.equal(core.safeEqual("secreto", "secreto-largo"), false);
  assert.equal(core.safeEqual("", ""), false);
});

test("preferencias por canal: por defecto solo menciones y asignaciones", () => {
  const p = core.DEFAULT_CHANNEL_PREFS;
  assert.equal(core.channelWants("MENTION", p), true);
  assert.equal(core.channelWants("ASSIGNED", p), true);
  assert.equal(core.channelWants("COMMENT", p), false);
  assert.equal(core.channelWants("REPLY", p), false);
  assert.equal(core.channelWants("DUE_CHANGED", p), false);
  assert.equal(core.channelWants("WAITING", { ...p, notifyDue: true }), true);
});

test("WhatsApp solo con número confirmado y consentimiento; con la plantilla antigua, solo menciones", () => {
  const now = new Date();
  assert.equal(core.channelUsable({ channel: "WHATSAPP", verifiedAt: null, consentAt: now }, "MENTION", false), false);
  assert.equal(core.channelUsable({ channel: "WHATSAPP", verifiedAt: now, consentAt: null }, "MENTION", false), false);
  assert.equal(core.channelUsable({ channel: "WHATSAPP", verifiedAt: now, consentAt: now }, "ASSIGNED", false), true);
  assert.equal(core.channelUsable({ channel: "WHATSAPP", verifiedAt: now, consentAt: now }, "ASSIGNED", true), false);
  assert.equal(core.channelUsable({ channel: "TELEGRAM", verifiedAt: null, consentAt: null }, "ASSIGNED", true), true);
});

test("errores: 403 de Telegram desconecta; Telegram reintenta 429, 5xx y red; WhatsApp solo 429 y lo que no llegó a salir", () => {
  const E = core.MessagingApiError;
  assert.equal(core.classifyFailure("TELEGRAM", new E("Forbidden: bot was blocked by the user", 403)), "disconnect");
  assert.equal(core.classifyFailure("TELEGRAM", new E("Bad Request: chat not found", 400)), "disconnect");
  assert.equal(core.classifyFailure("TELEGRAM", new E("Bad Request: message is too long", 400)), "fail");
  assert.equal(core.classifyFailure("TELEGRAM", new E("Too Many Requests", 429, 3)), "retry");
  assert.equal(core.classifyFailure("TELEGRAM", new E("x", 502)), "retry");
  assert.equal(core.classifyFailure("TELEGRAM", new Error("ECONNRESET")), "retry");
  // WhatsApp cobra cada mensaje: un 5xx, un ECONNRESET o un tiempo agotado pueden llegar con el mensaje ya enviado.
  assert.equal(core.classifyFailure("WHATSAPP", new E("x", 503)), "fail");
  assert.equal(core.classifyFailure("WHATSAPP", new E("x", 500)), "fail");
  assert.equal(core.classifyFailure("WHATSAPP", new E("x", 429)), "retry");
  assert.equal(core.classifyFailure("WHATSAPP", new E("x", 401)), "fail");
  assert.equal(core.classifyFailure("WHATSAPP", new E("timeout", 408)), "fail");
  assert.equal(core.classifyFailure("WHATSAPP", new core.MessagingNetworkError("x", "ECONNRESET")), "fail");
  assert.equal(core.classifyFailure("WHATSAPP", new Error("ECONNRESET")), "fail");
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) {
    assert.equal(core.classifyFailure("WHATSAPP", new core.MessagingNetworkError("x", code)), "retry", code);
    // Tal cual lo lanza fetch (undici): TypeError «fetch failed» con el código en cause.
    assert.equal(core.classifyFailure("WHATSAPP", Object.assign(new TypeError("fetch failed"), { cause: { code } })), "retry", code);
  }
});

test("reintentos limitados: 3 intentos, respeta Retry-After corto, no reintenta lo que no tiene arreglo ni al apagar", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  let calls = 0;
  await assert.rejects(core.withRetries("TELEGRAM", async () => { calls++; throw new core.MessagingApiError("x", 500); }, { sleep }));
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 4000]);

  waits.length = 0;
  calls = 0;
  const ok = await core.withRetries("TELEGRAM", async () => { if (++calls < 2) throw new core.MessagingApiError("x", 429, 2); return "bien"; }, { sleep });
  assert.equal(ok, "bien");
  assert.deepEqual(waits, [2000]);

  calls = 0;
  await assert.rejects(core.withRetries("TELEGRAM", async () => { calls++; throw new core.MessagingApiError("x", 403); }, { sleep }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(core.withRetries("TELEGRAM", async () => { calls++; throw new core.MessagingApiError("x", 429, 600); }, { sleep }));
  assert.equal(calls, 1, "un Retry-After largo no deja la petición colgada");
  calls = 0;
  await assert.rejects(core.withRetries("TELEGRAM", async () => { calls++; throw new Error("red"); }, { sleep, stopping: () => true }));
  assert.equal(calls, 1, "durante el apagado no se espera para reintentar");
});

test("precedencia de WhatsApp: lo guardado manda campo a campo; las variables WHATSAPP_* rellenan lo que falta", () => {
  const env = { WHATSAPP_TOKEN: "env-token-1234567890abcd", WHATSAPP_PHONE_NUMBER_ID: "111111", WHATSAPP_TEMPLATE_NAME: "mencion_pizarro", WHATSAPP_TEMPLATE_LANG: "es_ES" };
  const empty = core.parseWhatsappSettings([]);
  const fromEnv = core.resolveWhatsappConfig(env, empty, "");
  assert.equal(fromEnv.active, true, "con las variables de siempre sigue funcionando sin tocar nada");
  assert.equal(fromEnv.legacy, true);
  assert.equal(fromEnv.templateLang, "es_ES");
  assert.deepEqual(fromEnv.sources, { token: "env", phoneNumberId: "env", templateName: "env", templateLang: "env" });

  const saved = core.parseWhatsappSettings([{ key: core.WHATSAPP_PHONE_ID_KEY, value: "222222" }, { key: core.WHATSAPP_TEMPLATE_KEY, value: "aviso_pizarro" }, { key: core.WHATSAPP_TOKEN_KEY, value: "v2.x" }]);
  const mixed = core.resolveWhatsappConfig(env, saved, "db-token-1234567890abcd");
  assert.equal(mixed.token, "db-token-1234567890abcd");
  assert.equal(mixed.phoneNumberId, "222222");
  assert.equal(mixed.templateName, "aviso_pizarro");
  assert.equal(mixed.legacy, false);
  assert.equal(mixed.templateLang, "es_ES", "el idioma no guardado sale de la variable");

  // Una plantilla que solo viene de WHATSAPP_TEMPLATE_NAME es de antes de la configuración en Ajustes: formato antiguo
  // (4 variables), se llame como se llame. Al guardar su nombre en Ajustes, se usa el formato nuevo.
  const otherEnv = core.resolveWhatsappConfig({ ...env, WHATSAPP_TEMPLATE_NAME: "mi_plantilla" }, empty, "");
  assert.equal(otherEnv.legacy, true);
  const savedName = core.parseWhatsappSettings([{ key: core.WHATSAPP_TEMPLATE_KEY, value: "mi_plantilla" }]);
  assert.equal(core.resolveWhatsappConfig({ ...env, WHATSAPP_TEMPLATE_NAME: "mi_plantilla" }, savedName, "").legacy, false);
  assert.equal(core.resolveWhatsappConfig(env, core.parseWhatsappSettings([{ key: core.WHATSAPP_TEMPLATE_KEY, value: "mencion_pizarro" }]), "").legacy, true);
  assert.equal(core.resolveWhatsappConfig({ WHATSAPP_TOKEN: "t".repeat(24), WHATSAPP_PHONE_NUMBER_ID: "1" }, empty, "").legacy, false, "el nombre por defecto (aviso_pizarro) es el formato nuevo");

  const off = core.resolveWhatsappConfig(env, { ...empty, enabled: false }, "");
  assert.equal(off.active, false, "el administrador puede desactivarlo aunque estén las variables");
  const nothing = core.resolveWhatsappConfig({}, empty, "");
  assert.equal(nothing.complete, false);
  assert.equal(nothing.templateName, "aviso_pizarro");
  assert.equal(nothing.sources.templateName, "default");
});

test("validación del formulario de WhatsApp", () => {
  assert.equal(core.validateWhatsappSettings({ phoneNumberId: "12345", templateName: "aviso_pizarro", templateLang: "es_ES", templateLangEn: "en" }).ok, true);
  assert.equal(core.validateWhatsappSettings({ phoneNumberId: "12a45", templateName: "", templateLang: "", templateLangEn: "" }).ok, false);
  assert.equal(core.validateWhatsappSettings({ phoneNumberId: "", templateName: "Aviso Pizarro", templateLang: "", templateLangEn: "" }).ok, false);
  assert.equal(core.validateWhatsappSettings({ phoneNumberId: "", templateName: "", templateLang: "español", templateLangEn: "" }).ok, false);
  assert.equal(core.isTelegramToken("123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0"), true);
  assert.equal(core.isTelegramToken("123456789:corto"), false);
});

test("mensaje de Telegram: corto, en el idioma de la persona, con el contenido escapado y el enlace a la tarea", () => {
  const m = { type: "COMMENT" as const, actorName: "Ana <b>", taskTitle: "Pantalla & menú", projectName: "Web", excerpt: "Mira <esto>", url: "https://pizarro.example.com/p/1?task=2&x=1" };
  const es = core.telegramNoticeText(m, makeT("es"));
  assert.ok(es.startsWith("<b>Ana &lt;b&gt; ha comentado en «Pantalla &amp; menú»</b>"));
  assert.ok(es.includes("<i>Mira &lt;esto&gt;</i>"));
  assert.ok(es.includes('<a href="https://pizarro.example.com/p/1?task=2&amp;x=1">Abrir la tarea</a>'));
  assert.ok(!es.includes("<esto>"));
  const en = core.telegramNoticeText({ ...m, type: "ASSIGNED" }, makeT("en"));
  assert.match(en, /^<b>Ana &lt;b&gt; assigned “Pantalla &amp; menú” to you<\/b>/, "comillas del idioma, como en el email");
  const long = core.telegramNoticeText({ ...m, excerpt: "a".repeat(2000) }, makeT("es"));
  assert.ok(long.length < 700, "el extracto se recorta");
});

test("asignación: el título va en la cabecera y no se repite debajo (Telegram y email); WhatsApp solo lleva la cabecera", () => {
  const m = { type: "ASSIGNED" as const, actorName: "Ana", taskTitle: "Pantalla  de\ninicio", projectName: "Web", excerpt: "Pantalla de inicio", url: "https://pizarro.example.com/p/1?task=2" };
  const tg = core.telegramNoticeText(m, makeT("es"));
  assert.equal(tg, '<b>Ana te ha asignado «Pantalla de inicio»</b>\nWeb\n\n<a href="https://pizarro.example.com/p/1?task=2">Abrir la tarea</a>');
  assert.doesNotMatch(tg, /<i>/);
  // Título largo: el extracto es su principio recortado.
  const longTitle = "x".repeat(300);
  assert.doesNotMatch(core.telegramNoticeText({ ...m, taskTitle: longTitle, excerpt: `${"x".repeat(179)}…` }, makeT("es")), /<i>/);
  // Si la tarea cambió de título desde el aviso, el de entonces sí se ve; y en un lote, «3 tareas».
  assert.match(core.telegramNoticeText({ ...m, excerpt: "Portada" }, makeT("es")), /<i>Portada<\/i>/);
  assert.match(core.telegramNoticeText({ ...m, excerpt: assignedBatchExcerpt(3) }, makeT("es")), /<i>3 tareas<\/i>/);
  // Los demás avisos conservan su extracto aunque coincida con el título.
  assert.match(core.telegramNoticeText({ ...m, type: "MENTION" }, makeT("es")), /<i>Pantalla de inicio<\/i>/);
  const mail = mentionEmail(m, makeT("es"));
  assert.equal(mail.text, "Ana te ha asignado «Pantalla  de\ninicio» (Web)\n\nAbrir la tarea: https://pizarro.example.com/p/1?task=2\n");
  assert.doesNotMatch(mail.html, /<blockquote/);
  assert.match(mentionEmail({ ...m, type: "COMMENT", excerpt: "Mira esto" }, makeT("es")).html, /<blockquote[^>]*>Mira esto</);
  const wa = core.whatsappPayload("+34600111222", m, { templateName: "aviso_pizarro", templateLang: "es", templateLangEn: "en", legacy: false }, makeT("es"));
  assert.deepEqual(wa.template.components[0]!.parameters.map((p) => p.text), ["Ana te ha asignado «Pantalla de inicio»", "Web", m.url]);
});

test("Telegram HTML: lo interpolado se escapa siempre; el texto sin formato, entero", () => {
  const name = "Ana & <b>Bea</b>";
  assert.equal(core.telegramHtml`<b>${name}</b> ${3}`, "<b>Ana &amp; &lt;b&gt;Bea&lt;/b&gt;</b> 3");
  assert.equal(core.telegramPlain(`Listo, ${name}: <a href="https://evil.example.com">x</a>`), "Listo, Ana &amp; &lt;b&gt;Bea&lt;/b&gt;: &lt;a href=&quot;https://evil.example.com&quot;&gt;x&lt;/a&gt;");
  assert.equal(core.telegramTestText(makeT("es")), "<b>Mensaje de prueba de Pizarro</b>\nSi lo lees, los avisos por Telegram funcionan.");
  assert.equal(core.joinTelegramHtml([core.telegramPlain("a<"), core.telegramPlain("b")]), "a&lt;\nb");
});

test("código de WhatsApp: 6 cifras (admite espacios y guiones al copiarlo)", () => {
  assert.equal(core.normalizeWhatsappCode("123456"), "123456");
  assert.equal(core.normalizeWhatsappCode(" 123 456 "), "123456");
  assert.equal(core.normalizeWhatsappCode("123-456"), "123456");
  assert.equal(core.normalizeWhatsappCode("12345"), null);
  assert.equal(core.normalizeWhatsappCode("1234567"), null);
  assert.equal(core.normalizeWhatsappCode("12345a"), null);
  assert.equal(core.normalizeWhatsappCode(undefined), null);
  assert.deepEqual([core.WHATSAPP_CODE_MINUTES, core.WHATSAPP_CODE_ATTEMPTS], [15, 5]);
  assert.deepEqual(core.WHATSAPP_TESTS_PER_DAY, { user: 5, number: 3 });
});

test("reintentos de syncTelegram: espera creciente con tope de 5 minutos", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => core.telegramSyncRetryMs(n)), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(core.telegramSyncRetryMs(10), 5 * 60_000);
  assert.equal(core.telegramSyncRetryMs(1_000), 5 * 60_000);
});

test("registros sin secretos: token del bot, tokens largos y teléfono enmascarado", () => {
  const token = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";
  assert.equal(core.scrubSecrets(`fetch failed https://api.telegram.org/bot${token}/sendMessage`, []), "fetch failed https://api.telegram.org/bot***/sendMessage");
  assert.equal(core.scrubSecrets("error con EAAGsecreto123 dentro", ["EAAGsecreto123"]), "error con *** dentro");
  assert.equal(core.maskPhone("+34600111222"), "+34******222");
  assert.equal(core.last4("abcdefghij"), "ghij");
  assert.equal(core.last4("abc"), "");
});

test("diagnóstico: refleja Telegram y WhatsApp sin valores", () => {
  const rows = [
    { key: core.TELEGRAM_TOKEN_KEY, value: "v2.cifrado" },
    { key: core.TELEGRAM_ENABLED_KEY, value: "true" },
    { key: core.WHATSAPP_TOKEN_KEY, value: "v2.cifrado" },
    { key: core.WHATSAPP_PHONE_ID_KEY, value: "123456" },
  ];
  const f = messagingFlags({ APP_URL: "http://192.168.1.5:3000" }, rows, { telegram: 2, whatsapp: 1, whatsappPending: 1 });
  assert.equal(f.telegram, true);
  assert.equal(f.telegramMode, "polling");
  assert.equal(f.whatsapp, true);
  assert.deepEqual(f.whatsappSources, { credential: "db", numberId: "db", template: "default", language: "default" });
  assert.deepEqual(f.connectedChannels, { telegram: 2, whatsapp: 1, whatsappPending: 1 });
  assert.equal(JSON.stringify(f).includes("123456"), false);
  const none = messagingFlags({}, []);
  assert.equal(none.telegram, false);
  assert.equal(none.whatsapp, false);
});

test("API de Telegram (fetch simulado): errores sin el token y con Retry-After", async () => {
  const token = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ ok: false, error_code: 429, description: `Too Many Requests bot${token}`, parameters: { retry_after: 7 } }), { status: 429 });
  }) as typeof fetch;
  await assert.rejects(telegramCall(token, "sendMessage", {}), (err: unknown) => {
    assert.ok(err instanceof core.MessagingApiError);
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSec, 7);
    assert.equal(err.message.includes(token), false);
    return true;
  });
  assert.equal(urls[0], `https://api.telegram.org/bot${token}/sendMessage`);

  globalThis.fetch = (async () => { throw new TypeError(`fetch failed for https://api.telegram.org/bot${token}/getMe`); }) as typeof fetch;
  await assert.rejects(getBot(token), (err: Error) => !err.message.includes(token));

  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { id: 42, is_bot: true, username: "pizarro_bot", first_name: "Pizarro" } }))) as typeof fetch;
  assert.deepEqual(await getBot(token), { id: "42", username: "pizarro_bot", name: "Pizarro" });
});

test("las guías llevan el texto exacto de la plantilla que espera Pizarro", async () => {
  const { readFile } = await import("node:fs/promises");
  const es = await readFile(new URL("../docs/guias/whatsapp.md", import.meta.url), "utf8");
  const en = await readFile(new URL("../docs/guias/en/whatsapp.md", import.meta.url), "utf8");
  for (const doc of [es, en]) {
    assert.ok(doc.includes(core.WHATSAPP_TEMPLATE_BODY.es), "cuerpo en español");
    assert.ok(doc.includes(core.WHATSAPP_TEMPLATE_BODY.en), "cuerpo en inglés");
    assert.ok(doc.includes(core.DEFAULT_WHATSAPP_TEMPLATE));
  }
});
