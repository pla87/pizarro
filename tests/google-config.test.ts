import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_GOOGLE_SETTINGS, googleRedirectUris, isGoogleActive, resolveGoogleConfig, validateGoogleSettings } from "../src/lib/google-config-core";

const saved = { clientId: "bd-id.apps.googleusercontent.com", workspaceDomain: "bd.example", hasSecret: true };

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
});
