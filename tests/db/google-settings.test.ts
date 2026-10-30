// Acceso con Google configurado por un administrador: guardado cifrado, precedencia de GOOGLE_*, googleEnabled.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeUser } from "./helpers";
import { saveGoogleSettings } from "../../src/actions/google-settings";
import { decryptSecret } from "../../src/lib/crypto";
import { googleConfig, getGoogleSettingsView, googlePolicyEnv, refreshGoogleConfig } from "../../src/lib/google-config";
import { googleEnabled } from "../../src/lib/google";
import { flushLogs } from "../../src/lib/log";
import { googleOnly } from "../../src/lib/auth-policy";

const form = { clientId: "1234567890-abcdef.apps.googleusercontent.com", workspaceDomain: "" };
const savedSecret = async () => (await db.appState.findUnique({ where: { key: "google.clientSecretEnc" } }))?.value ?? null;
const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_DOMAIN", "AUTH_GOOGLE_ONLY"] as const;

async function clean() {
  for (const k of ENV_KEYS) process.env[k] = "";
  process.env.APP_URL = "https://pizarro.example.test";
  await db.appState.deleteMany({ where: { key: { startsWith: "google." } } });
  await refreshGoogleConfig();
}
afterEach(clean);

async function admin() {
  const a = await makeUser({ role: "ADMIN" });
  await loginAs(a);
  return a;
}

describe("ajustes de Google", () => {
  test("solo administradores", async () => {
    await clean();
    await loginAs(await makeUser());
    expectFail(await saveGoogleSettings({ ...form, secret: "x" }), FORBIDDEN);
    assert.equal(googleEnabled(), false);
  });

  test("guarda el secreto cifrado, no lo devuelve y activa googleEnabled", async () => {
    await clean();
    await admin();
    assert.equal(googleEnabled(), false);
    const res = expectOk(await saveGoogleSettings({ ...form, workspaceDomain: "@Empresa.example", secret: "GOCSPX-secreto-123" }));
    assert.equal(JSON.stringify(res).includes("GOCSPX-secreto-123"), false);
    assert.equal(res.settings.hasSecret, true);
    assert.equal(res.settings.workspaceDomain, "empresa.example");
    const stored = await savedSecret();
    assert.ok(stored && stored.startsWith("v2.") && !stored.includes("GOCSPX"));
    assert.equal(decryptSecret(stored), "GOCSPX-secreto-123");
    const view = await getGoogleSettingsView();
    assert.equal(JSON.stringify(view).includes("GOCSPX-secreto-123"), false);
    assert.equal(view.active, true);
    assert.equal(view.redirectUris?.login, "https://pizarro.example.test/api/auth/google/callback");
    assert.equal(view.redirectUris?.docs, "https://pizarro.example.test/api/google/callback");
    assert.equal(googleEnabled(), true);
    const cfg = googleConfig();
    assert.equal(cfg.source, "db");
    assert.equal(cfg.clientSecret, "GOCSPX-secreto-123");
    assert.equal(cfg.domain, "empresa.example");
    // La política «solo Google» también ve la configuración guardada.
    process.env.AUTH_GOOGLE_ONLY = "true";
    assert.equal(googleOnly(googlePolicyEnv()), true);
    // El registro de auditoría no lleva ni el secreto ni el ID.
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "settings.saveGoogle" }, select: { message: true, details: true } });
    assert.ok(logs.length >= 1);
    assert.equal(JSON.stringify(logs).includes("GOCSPX"), false);
    assert.equal(JSON.stringify(logs).includes("apps.googleusercontent.com"), false);
    assert.match(JSON.stringify(logs), /"authChange":"set"/);
  });

  test("sin APP_URL no está activo; el secreto vacío conserva el guardado", async () => {
    await clean();
    await admin();
    expectOk(await saveGoogleSettings({ ...form, secret: "uno" }));
    expectOk(await saveGoogleSettings({ ...form, workspaceDomain: "empresa.example", secret: "" }));
    assert.equal(decryptSecret((await savedSecret())!), "uno");
    process.env.APP_URL = "";
    assert.equal(googleEnabled(), false);
    assert.equal((await getGoogleSettingsView()).appUrlMissing, true);
  });

  test("cambiar el ID de cliente exige escribir el secreto de nuevo", async () => {
    await clean();
    await admin();
    expectOk(await saveGoogleSettings({ ...form, secret: "uno" }));
    expectFail(await saveGoogleSettings({ ...form, clientId: "9999999999-otro.apps.googleusercontent.com", secret: "" }), /Escribe el secreto de nuevo/);
    assert.equal(googleConfig().clientId, form.clientId);
    expectOk(await saveGoogleSettings({ ...form, clientId: "9999999999-otro.apps.googleusercontent.com", secret: "dos" }));
    assert.equal(decryptSecret((await savedSecret())!), "dos");
  });

  test("valida los datos y sin ID de cliente se desactiva y borra el secreto", async () => {
    await clean();
    await admin();
    expectFail(await saveGoogleSettings({ ...form, clientId: "con espacios!", secret: "x" }), /ID de cliente/);
    expectFail(await saveGoogleSettings({ ...form, workspaceDomain: "no valido", secret: "x" }), /dominio/);
    expectFail(await saveGoogleSettings({ ...form }), /Falta el secreto/);
    expectOk(await saveGoogleSettings({ ...form, secret: "x1234" }));
    assert.equal(googleEnabled(), true);
    expectOk(await saveGoogleSettings({ clientId: "", workspaceDomain: "" }));
    assert.equal(googleEnabled(), false);
    assert.equal(await savedSecret(), null);
  });

  test("las variables GOOGLE_* del servidor mandan y la pantalla es de solo lectura", async () => {
    await clean();
    await admin();
    expectOk(await saveGoogleSettings({ ...form, workspaceDomain: "bd.example", secret: "de-la-bd" }));
    process.env.GOOGLE_CLIENT_ID = "env-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "de-entorno";
    const cfg = googleConfig();
    assert.equal(cfg.source, "env");
    assert.equal(cfg.clientId, "env-id.apps.googleusercontent.com");
    assert.equal(cfg.clientSecret, "de-entorno");
    // El dominio guardado sigue valiendo si el servidor no define GOOGLE_WORKSPACE_DOMAIN; si lo define, manda.
    assert.equal(cfg.domain, "bd.example");
    process.env.GOOGLE_WORKSPACE_DOMAIN = "env.example";
    assert.equal(googleConfig().domain, "env.example");
    const view = await getGoogleSettingsView();
    assert.equal(view.envCredentials, true);
    assert.equal(JSON.stringify(view).includes("de-entorno"), false);
    assert.equal(JSON.stringify(view).includes("env-id"), false);
    expectFail(await saveGoogleSettings({ ...form }), /configurado en el servidor/);
    // Sin variables vuelve a mandar lo guardado.
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.GOOGLE_WORKSPACE_DOMAIN = "";
    assert.equal(googleConfig().source, "db");
  });
});
