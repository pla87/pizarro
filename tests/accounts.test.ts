import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);

const core = await import("../src/lib/auth-token-core");
const { summarizeUserAgent, deviceLabel } = await import("../src/lib/user-agent");
const { passwordSchema, passwordByteLength, MAX_PASSWORD_BYTES } = await import("../src/lib/password");
const { loginRateKeys, rateLimit, resetRateLimit } = await import("../src/lib/rate-limit");
const { makeT } = await import("../src/i18n/core");

test("token: aleatorio, con hash estable y distinto del token", () => {
  const a = core.newToken();
  const b = core.newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  assert.equal(core.hashAuthToken(a), core.hashAuthToken(a));
  assert.notEqual(core.hashAuthToken(a), core.hashAuthToken(b));
  assert.notEqual(core.hashAuthToken(a), a);
  assert.match(core.hashAuthToken(a), /^[0-9a-f]{64}$/);
});

test("hash de token y de dispositivo no se pueden confundir", () => {
  assert.notEqual(core.hashAuthToken("abc"), core.hashDeviceId("abc"));
});

test("caducidad: 30 min para contraseñas y email, 72 h para invitaciones", () => {
  const now = Date.UTC(2026, 9, 23, 10, 0, 0);
  assert.equal(core.tokenExpiry("PASSWORD_RESET", now).getTime() - now, 30 * 60_000);
  assert.equal(core.tokenExpiry("PASSWORD_CHANGE", now).getTime() - now, 30 * 60_000);
  assert.equal(core.tokenExpiry("EMAIL_CHANGE", now).getTime() - now, 30 * 60_000);
  assert.equal(core.tokenExpiry("INVITE", now).getTime() - now, 72 * 3_600_000);
});

test("un enlace solo sirve una vez y antes de caducar", () => {
  const now = Date.now();
  const future = new Date(now + 1000);
  assert.equal(core.isTokenUsable({ expiresAt: future, usedAt: null }, now), true);
  assert.equal(core.isTokenUsable({ expiresAt: future, usedAt: new Date(now) }, now), false);
  assert.equal(core.isTokenUsable({ expiresAt: new Date(now - 1), usedAt: null }, now), false);
  assert.equal(core.isTokenUsable({ expiresAt: new Date(now), usedAt: null }, now), false);
});

test("User-Agent: navegador y sistema", () => {
  const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  assert.deepEqual(summarizeUserAgent(chromeWin), { browser: "Chrome", os: "Windows" });
  assert.equal(summarizeUserAgent(chromeWin + " Edg/120.0.0.0").browser, "Edge");
  const safariIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.deepEqual(summarizeUserAgent(safariIos), { browser: "Safari", os: "iOS" });
  const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  assert.deepEqual(summarizeUserAgent(chromeAndroid), { browser: "Chrome", os: "Android" });
  const firefoxLinux = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
  assert.deepEqual(summarizeUserAgent(firefoxLinux), { browser: "Firefox", os: "Linux" });
  const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  assert.deepEqual(summarizeUserAgent(safariMac), { browser: "Safari", os: "macOS" });
  assert.deepEqual(summarizeUserAgent(null), { browser: null, os: null });
  assert.deepEqual(summarizeUserAgent("curl/8.0"), { browser: null, os: null });
});

test("etiqueta de dispositivo traducida", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36";
  assert.equal(deviceLabel(ua, makeT("es")), "Chrome en Windows");
  assert.equal(deviceLabel(ua, makeT("en")), "Chrome on Windows");
  assert.equal(deviceLabel(null, makeT("es")), "Dispositivo desconocido");
});

test("contraseña: mínimo 10 caracteres y máximo 72 bytes (UTF-8)", () => {
  const schema = passwordSchema();
  assert.equal(schema.safeParse("123456789").success, false);
  assert.equal(schema.safeParse("1234567890").success, true);
  assert.equal(schema.safeParse("a".repeat(72)).success, true);
  assert.equal(schema.safeParse("a".repeat(73)).success, false);
  // 36 «ñ» = 72 bytes; 37 = 74 bytes aunque sean pocos caracteres.
  assert.equal(passwordByteLength("ñ".repeat(36)), MAX_PASSWORD_BYTES);
  assert.equal(schema.safeParse("ñ".repeat(36)).success, true);
  assert.equal(schema.safeParse("ñ".repeat(37)).success, false);
  assert.equal(schema.safeParse("😀".repeat(19)).success, false); // 76 bytes
  const long = schema.safeParse("a".repeat(80));
  assert.ok(!long.success && /72 bytes/.test(long.error.issues[0]!.message));
});

test("límite de acceso: clave por pareja IP+email normalizada y otra por IP", () => {
  const a = loginRateKeys("1.2.3.4", "Ana@Example.com ");
  const b = loginRateKeys("1.2.3.4", "ana@example.com");
  assert.deepEqual(a, b);
  assert.notEqual(a.pair, loginRateKeys("5.6.7.8", "ana@example.com").pair);
  assert.notEqual(a.pair, loginRateKeys("1.2.3.4", "otra@example.com").pair);
  assert.equal(a.ip, loginRateKeys("1.2.3.4", "otra@example.com").ip);
  assert.ok(a.pair.length < 300);
});

test("límite por pareja: bloquear a un atacante no bloquea a otra IP", () => {
  const attacker = loginRateKeys("9.9.9.9", "victima@example.com");
  const owner = loginRateKeys("8.8.8.8", "victima@example.com");
  for (let i = 0; i < 8; i++) assert.equal(rateLimit(attacker.pair, 8, 60_000), true);
  assert.equal(rateLimit(attacker.pair, 8, 60_000), false);
  assert.equal(rateLimit(owner.pair, 8, 60_000), true);
  resetRateLimit(attacker.pair);
  resetRateLimit(owner.pair);
});
