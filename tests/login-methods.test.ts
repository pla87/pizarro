import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);

const core = await import("../src/lib/two-factor-core");
const idt = await import("../src/lib/google-id-token");
const policy = await import("../src/lib/auth-policy");

// --- Base32 ---

test("base32: vectores de la RFC 4648", () => {
  const cases: [string, string][] = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
  for (const [plain, b32] of cases) {
    assert.equal(core.base32Encode(Buffer.from(plain)), b32);
    assert.equal(core.base32Decode(b32).toString(), plain);
  }
});

test("base32: tolera minúsculas, espacios, guiones y relleno; rechaza caracteres ajenos", () => {
  assert.equal(core.base32Decode("mzxw 6ytb-oi======").toString(), "foobar");
  assert.throws(() => core.base32Decode("MZXW1"));
  assert.throws(() => core.base32Decode("MZXW!"));
});

test("base32: ida y vuelta con bytes aleatorios", () => {
  for (let n = 1; n < 40; n++) {
    const buf = Buffer.alloc(n, n * 7);
    assert.deepEqual(core.base32Decode(core.base32Encode(buf)), buf);
  }
  const secret = core.generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(secret, core.generateTotpSecret());
});

// --- TOTP (RFC 6238, apéndice B, SHA-1, 8 dígitos; secreto ASCII «12345678901234567890») ---

const RFC_SECRET = core.base32Encode(Buffer.from("12345678901234567890"));

test("TOTP: vectores de prueba de la RFC 6238", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) assert.equal(core.totpAt(RFC_SECRET, seconds * 1000, 8), code, `t=${seconds}`);
});

test("TOTP: con 6 dígitos son los 6 últimos del código de 8", () => {
  assert.equal(core.totpAt(RFC_SECRET, 59_000), "287082");
  assert.equal(core.totpAt(RFC_SECRET, 1234567890_000), "005924");
});

test("TOTP: acepta ±1 paso, rechaza ±2 y devuelve el paso aceptado", () => {
  const now = 1_700_000_000_000;
  const step = core.totpStep(now);
  const at = (s: number) => core.totpAt(RFC_SECRET, s * 30_000);
  assert.equal(core.verifyTotp(RFC_SECRET, at(step), now), step);
  assert.equal(core.verifyTotp(RFC_SECRET, at(step - 1), now), step - 1);
  assert.equal(core.verifyTotp(RFC_SECRET, at(step + 1), now), step + 1);
  assert.equal(core.verifyTotp(RFC_SECRET, at(step - 2), now), null);
  assert.equal(core.verifyTotp(RFC_SECRET, at(step + 2), now), null);
});

test("TOTP: un paso ya usado no se acepta otra vez", () => {
  const now = 1_700_000_000_000;
  const step = core.totpStep(now);
  const code = core.totpAt(RFC_SECRET, now);
  assert.equal(core.verifyTotp(RFC_SECRET, code, now, { lastStep: step - 1 }), step);
  assert.equal(core.verifyTotp(RFC_SECRET, code, now, { lastStep: step }), null);
});

test("TOTP: ignora espacios y rechaza lo que no son 6 dígitos", () => {
  const now = 1_700_000_000_000;
  const code = core.totpAt(RFC_SECRET, now);
  assert.notEqual(core.verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now), null);
  for (const bad of ["", "12345", "1234567", "abcdef", "12345a", code + "0"]) assert.equal(core.verifyTotp(RFC_SECRET, bad, now), null);
});

test("otpauth://: etiqueta, secreto, emisor y parámetros estándar", () => {
  const uri = core.otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "ana+x@example.com", issuer: "Pizarro" });
  const url = new URL(uri);
  assert.equal(url.protocol, "otpauth:");
  assert.equal(url.host, "totp");
  assert.equal(decodeURIComponent(url.pathname), "/Pizarro:ana+x@example.com");
  assert.equal(url.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(url.searchParams.get("issuer"), "Pizarro");
  assert.equal(url.searchParams.get("algorithm"), "SHA1");
  assert.equal(url.searchParams.get("digits"), "6");
  assert.equal(url.searchParams.get("period"), "30");
});

// --- Códigos de recuperación y de email ---

test("recuperación: 10 códigos distintos con formato xxxxx-xxxxx", () => {
  const codes = core.generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) {
    assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    assert.doesNotMatch(c, /[01ilo]/);
  }
});

test("recuperación: se normaliza lo que escribe la persona", () => {
  assert.equal(core.normalizeRecoveryCode("ABCDE-FGHJK"), "abcde-fghjk");
  assert.equal(core.normalizeRecoveryCode("  abcde fghjk "), "abcde-fghjk");
  assert.equal(core.normalizeRecoveryCode("abcdefghjk"), "abcde-fghjk");
  for (const bad of ["", "123456", "abcde-fghj", "abcde-fghjkm", "abcde-fgh0k", "abcde-fghil"]) assert.equal(core.normalizeRecoveryCode(bad), null);
});

test("recuperación: solo se guarda un HMAC estable, distinto del código y de otros usos", () => {
  const [a, b] = core.generateRecoveryCodes(2) as [string, string];
  const h = core.hashRecoveryCode(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, core.hashRecoveryCode(a));
  assert.notEqual(h, core.hashRecoveryCode(b));
  assert.notEqual(h, a);
  assert.notEqual(core.hashRecoveryCode("123456"), core.hashEmailCode("c1", "123456"));
});

test("email: código de 6 dígitos, hash ligado al desafío", () => {
  for (let i = 0; i < 50; i++) assert.match(core.generateEmailCode(), /^\d{6}$/);
  assert.equal(core.hashEmailCode("c1", "123456"), core.hashEmailCode("c1", "123456"));
  assert.notEqual(core.hashEmailCode("c1", "123456"), core.hashEmailCode("c2", "123456"));
  assert.notEqual(core.hashEmailCode("c1", "123456"), core.hashEmailCode("c1", "123457"));
  assert.equal(core.EMAIL_CODE_TTL_MS, 10 * 60_000);
});

// --- Google: URL de autorización y PKCE ---

test("PKCE: el desafío es el SHA-256 en base64url del verificador", () => {
  const { verifier, challenge } = idt.newPkce();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.notEqual(idt.newPkce().verifier, verifier);
});

test("URL de acceso con Google: solo openid email profile, PKCE S256, state y nonce", () => {
  const url = new URL(idt.buildLoginAuthUrl({ clientId: "cid", redirectUri: "https://app.test/api/auth/google/callback", state: "st", nonce: "no", challenge: "ch", domain: "empresa.test" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = url.searchParams;
  assert.equal(q.get("scope"), "openid email profile");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("code_challenge"), "ch");
  assert.equal(q.get("state"), "st");
  assert.equal(q.get("nonce"), "no");
  assert.equal(q.get("redirect_uri"), "https://app.test/api/auth/google/callback");
  assert.equal(q.get("hd"), "empresa.test");
  assert.equal(q.get("access_type"), null, "sin refresh token: Drive es una conexión aparte");
  assert.equal(new URL(idt.buildLoginAuthUrl({ clientId: "c", redirectUri: "r", state: "s", nonce: "n", challenge: "c" })).searchParams.get("hd"), null);
});

// --- Google: firma del id_token ---

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" } as import("../src/lib/google-id-token").Jwk;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims: object, header: object = { alg: "RS256", kid: "k1", typ: "JWT" }, key = privateKey): string {
  const data = `${b64(header)}.${b64(claims)}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(key).toString("base64url")}`;
}

test("id_token: firma RS256 válida devuelve las claims", () => {
  const claims = verifyClaims(sign({ sub: "1", email: "a@b.c" }));
  assert.equal(claims?.sub, "1");
});
function verifyClaims(token: string, keys = [jwk]) {
  return idt.verifyIdTokenSignature(token, keys);
}

test("id_token: rechaza payload alterado, otra clave, kid desconocido y algoritmos distintos de RS256", () => {
  const good = sign({ sub: "1", email: "a@b.c" });
  const [h, , s] = good.split(".") as [string, string, string];
  assert.equal(verifyClaims(`${h}.${b64({ sub: "2", email: "a@b.c" })}.${s}`), null);
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.equal(verifyClaims(sign({ sub: "1" }, undefined, other.privateKey)), null);
  assert.equal(verifyClaims(sign({ sub: "1" }, { alg: "RS256", kid: "otro" })), null);
  assert.equal(verifyClaims(sign({ sub: "1" }, { alg: "none", kid: "k1" })), null);
  assert.equal(verifyClaims(sign({ sub: "1" }, { alg: "HS256", kid: "k1" })), null);
  assert.equal(verifyClaims(`${h}.${b64({ sub: "1" })}.`), null);
  assert.equal(verifyClaims("basura"), null);
  assert.equal(verifyClaims(good, []), null);
  assert.equal(idt.idTokenKeyId(good), "k1");
});

// --- Google: claims ---

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const sec = NOW / 1000;
const base = {
  iss: "https://accounts.google.com", aud: "cid", sub: "1234567890", email: "Ana@Empresa.test", email_verified: true,
  name: "Ana", nonce: "n1", exp: sec + 3000, iat: sec - 10, hd: "empresa.test",
};
const check = (patch: Record<string, unknown>, opts: { domain?: string | null; nonce?: string } = {}) =>
  idt.validateIdTokenClaims({ ...base, ...patch }, { clientId: "cid", nonce: opts.nonce ?? "n1", domain: opts.domain, now: NOW });

test("claims: token correcto; el email se devuelve en minúsculas", () => {
  assert.deepEqual(check({}), { ok: true, sub: "1234567890", email: "ana@empresa.test", name: "Ana" });
  assert.equal(check({ iss: "accounts.google.com" }).ok, true);
  assert.equal(check({ email_verified: "true" }).ok, true);
});

test("claims: rechaza emisor, audiencia, caducidad, nonce y email sin verificar", () => {
  assert.deepEqual(check({ iss: "https://evil.test" }), { ok: false, reason: "issuer" });
  assert.deepEqual(check({ aud: "otro" }), { ok: false, reason: "audience" });
  assert.deepEqual(check({ aud: ["cid", "otro"] }), { ok: false, reason: "audience" }, "varias audiencias exigen azp");
  assert.equal(check({ aud: ["cid", "otro"], azp: "cid" }).ok, true);
  assert.deepEqual(check({ exp: sec - 120 }), { ok: false, reason: "expired" });
  assert.deepEqual(check({ exp: "x" }), { ok: false, reason: "expired" });
  assert.deepEqual(check({ iat: sec + 3600 }), { ok: false, reason: "expired" });
  assert.deepEqual(check({ nonce: "otro" }), { ok: false, reason: "nonce" });
  assert.deepEqual(check({ nonce: undefined }), { ok: false, reason: "nonce" });
  assert.deepEqual(check({}, { nonce: "" }), { ok: false, reason: "nonce" });
  assert.deepEqual(check({ email_verified: false }), { ok: false, reason: "email_unverified" });
  assert.deepEqual(check({ email_verified: undefined }), { ok: false, reason: "email_unverified" });
  assert.deepEqual(check({ email_verified: "false" }), { ok: false, reason: "email_unverified" });
});

test("claims: con dominio de Workspace exige hd y email de ese dominio", () => {
  assert.equal(check({}, { domain: "Empresa.test" }).ok, true);
  assert.deepEqual(check({ hd: undefined }, { domain: "empresa.test" }), { ok: false, reason: "domain" });
  assert.deepEqual(check({ hd: "otra.test" }, { domain: "empresa.test" }), { ok: false, reason: "domain" });
  assert.deepEqual(check({ email: "ana@otra.test" }, { domain: "empresa.test" }), { ok: false, reason: "domain" });
  assert.deepEqual(check({ email: "ana@sub.empresa.test" }, { domain: "empresa.test" }), { ok: false, reason: "domain" });
  assert.equal(check({ hd: undefined, email: "ana@correo.example" }, { domain: null }).ok, true, "sin dominio configurado vale cualquier cuenta verificada");
});

test("claims: sin sub o email no son válidas", () => {
  assert.deepEqual(check({ sub: undefined }), { ok: false, reason: "format" });
  assert.deepEqual(check({ sub: "" }), { ok: false, reason: "format" });
  assert.deepEqual(check({ email: "sin-arroba" }), { ok: false, reason: "format" });
  assert.deepEqual(check({ email: 5 }), { ok: false, reason: "format" });
});

// --- Política «solo Google» ---

test("política: por defecto se permiten ambos métodos", () => {
  assert.equal(policy.googleOnly({}), false);
  assert.equal(policy.passwordLoginAllowed("MEMBER", {}), true);
  assert.equal(policy.passwordLoginAllowed("ADMIN", {}), true);
  assert.equal(policy.passwordFormVisible({}), true);
});

test("política: AUTH_GOOGLE_ONLY quita la contraseña salvo administradores con AUTH_ALLOW_ADMIN_PASSWORD", () => {
  const google = { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", APP_URL: "https://app.test" };
  const only = { ...google, AUTH_GOOGLE_ONLY: "true" };
  assert.equal(policy.passwordLoginAllowed("MEMBER", only), false);
  assert.equal(policy.passwordLoginAllowed("ADMIN", only), false);
  assert.equal(policy.passwordFormVisible(only), false);
  const breakGlass = { ...only, AUTH_ALLOW_ADMIN_PASSWORD: "true" };
  assert.equal(policy.passwordLoginAllowed("ADMIN", breakGlass), true);
  assert.equal(policy.passwordLoginAllowed("MEMBER", breakGlass), false);
  assert.equal(policy.passwordFormVisible(breakGlass), true);
});

test("política: sin Google configurado «solo Google» no tiene efecto (no deja a nadie fuera)", () => {
  const env = { AUTH_GOOGLE_ONLY: "true" };
  assert.equal(policy.googleOnly(env), false);
  assert.equal(policy.passwordLoginAllowed("MEMBER", env), true);
  assert.equal(policy.passwordLoginAllowed("MEMBER", { ...env, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }), true, "falta APP_URL: Google no puede funcionar");
});
