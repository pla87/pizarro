import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_GOOGLE_SETTINGS, appDomainInfo, googleRedirectUris, isGoogleActive, resolveGoogleConfig, validateGoogleSettings } from "../src/lib/google-config-core";

const saved = { clientId: "bd-id.apps.googleusercontent.com", workspaceDomain: "bd.example", hasSecret: true, publicContactEmail: "" };

describe("configuración de Google (parte pura)", () => {
  test("precedencia: ID y secreto del servidor mandan; el dominio del servidor manda sobre el guardado", () => {
    const env = { GOOGLE_CLIENT_ID: "env-id", GOOGLE_CLIENT_SECRET: "env-secret", APP_URL: "https://x.example" };
    const e = resolveGoogleConfig(env, saved, "bd-secret");
    assert.equal(e.source, "env");
    assert.equal(e.clientSecret, "env-secret");
    assert.equal(e.domain, "bd.example");
    assert.equal(resolveGoogleConfig({ ...env, GOOGLE_WORKSPACE_DOMAIN: "env.example" }, saved, "").domain, "env.example");
    const d = resolveGoogleConfig({}, saved, "bd-secret");
    assert.equal(d.source, "db");
    assert.equal(d.clientSecret, "bd-secret");
    // Con solo uno de los dos del servidor no vale: se usa lo guardado.
    assert.equal(resolveGoogleConfig({ GOOGLE_CLIENT_ID: "solo-id" }, saved, "bd-secret").source, "db");
    assert.equal(resolveGoogleConfig({}, saved, "").source, "none");
    assert.equal(resolveGoogleConfig({}, EMPTY_GOOGLE_SETTINGS, "x").source, "none");
  });

  test("activo solo con APP_URL", () => {
    const c = resolveGoogleConfig({}, saved, "s");
    assert.equal(isGoogleActive(c, {}), false);
    assert.equal(isGoogleActive(c, { APP_URL: "https://x.example" }), true);
  });

  test("direcciones de redirección", () => {
    assert.deepEqual(googleRedirectUris("https://x.example/"), { login: "https://x.example/api/auth/google/callback", docs: "https://x.example/api/google/callback" });
    assert.equal(googleRedirectUris(undefined), null);
  });

  test("validación", () => {
    assert.deepEqual(validateGoogleSettings({ clientId: " abc-123.apps.googleusercontent.com ", workspaceDomain: "@Empresa.COM" }), { ok: true, value: { clientId: "abc-123.apps.googleusercontent.com", workspaceDomain: "empresa.com" } });
    assert.equal(validateGoogleSettings({ clientId: "a b c d e", workspaceDomain: "" }).ok, false);
    assert.equal(validateGoogleSettings({ clientId: "", workspaceDomain: "sin punto" }).ok, false);
    assert.equal(validateGoogleSettings({ clientId: "", workspaceDomain: "" }).ok, true);
  });

  test("email de contacto público: opcional y validado", () => {
    assert.equal(validateGoogleSettings({ clientId: "", workspaceDomain: "", publicContactEmail: "no-es-email" }).ok, false);
    assert.deepEqual(validateGoogleSettings({ clientId: "", workspaceDomain: "", publicContactEmail: " a@example.com " }), { ok: true, value: { clientId: "", workspaceDomain: "", publicContactEmail: "a@example.com" } });
    assert.equal(validateGoogleSettings({ clientId: "", workspaceDomain: "", publicContactEmail: "" }).ok, true);
  });

  test("dominio autorizado a partir de APP_URL", () => {
    assert.deepEqual(appDomainInfo("https://pizarro.empresa.com/"), { host: "pizarro.empresa.com", domain: "empresa.com", kind: "ok" });
    assert.equal(appDomainInfo("https://tablon.empresa.co.uk").domain, "empresa.co.uk");
    assert.deepEqual(appDomainInfo("https://pizarro-prod.up.railway.app"), { host: "pizarro-prod.up.railway.app", domain: "pizarro-prod.up.railway.app", kind: "shared" });
    assert.equal(appDomainInfo("http://localhost:3000").kind, "local");
    assert.equal(appDomainInfo("http://192.168.1.5:3000").kind, "local");
    assert.equal(appDomainInfo(undefined).kind, "none");
  });
});
