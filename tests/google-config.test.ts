import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EMPTY_GOOGLE_SETTINGS, appDomainInfo, detectUrlMismatch, googleRedirectUris, originFromHeaders, isGoogleActive, resolveGoogleConfig, validateGoogleSettings } from "../src/lib/google-config-core";

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

describe("dominio autorizado: alojamientos compartidos y sufijos de dos etiquetas", () => {
  test("alojamientos compartidos", () => {
    for (const host of ["miapp-x1y2z.ondigitalocean.app", "1-2-3-4.sslip.io", "app.nip.io", "svc-abc.koyeb.app", "svc-hash-uc.a.run.app", "a.fly.dev", "a.onrender.com", "a.herokuapp.com", "a.pages.dev", "a.workers.dev", "a.netlify.app", "a.vercel.app"]) {
      const info = appDomainInfo(`https://${host}`);
      assert.equal(info.kind, "shared", host);
      assert.equal(info.domain, host, host);
    }
  });
  test("sufijos de país de dos etiquetas", () => {
    assert.equal(appDomainInfo("https://pizarro.empresa.com.cn").domain, "empresa.com.cn");
    assert.equal(appDomainInfo("https://pizarro.empresa.co.kr").domain, "empresa.co.kr");
    assert.equal(appDomainInfo("https://pizarro.ayuntamiento.gov.uk").domain, "ayuntamiento.gov.uk");
    assert.equal(appDomainInfo("https://x.empresa.com.au").domain, "empresa.com.au");
    assert.equal(appDomainInfo("https://x.empresa.co.jp").domain, "empresa.co.jp");
    assert.equal(appDomainInfo("https://x.empresa.com.mx").domain, "empresa.com.mx");
    assert.equal(appDomainInfo("https://x.empresa.com").domain, "empresa.com");
  });

  test("origen de acceso a partir de las cabeceras", () => {
    assert.equal(originFromHeaders({ host: "127.0.0.1:3341" }), "http://127.0.0.1:3341");
    assert.equal(originFromHeaders({ host: "app:3000", forwardedHost: "Pizarro.Example.com", forwardedProto: "https" }), "https://pizarro.example.com");
    assert.equal(originFromHeaders({ host: "pizarro.example.com" }), "https://pizarro.example.com");
    assert.equal(originFromHeaders({ forwardedHost: "a.example.com, b.example.com", forwardedProto: "https, http" }), "https://a.example.com");
    assert.equal(originFromHeaders({ host: null }), "");
    assert.equal(originFromHeaders({ host: "x.example.com/evil" }), "");
    assert.equal(originFromHeaders({ host: "x.example.com", forwardedProto: "javascript" }), "");
  });

  test("detectUrlMismatch: APP_URL frente a la dirección de acceso", () => {
    assert.equal(detectUrlMismatch("https://pizarro.example.com/", "https://pizarro.example.com"), null);
    assert.equal(detectUrlMismatch("https://pizarro.example.com", "https://PIZARRO.example.com:443"), null);
    assert.equal(detectUrlMismatch(undefined, "https://pizarro.example.com"), null);
    assert.equal(detectUrlMismatch("https://pizarro.example.com", ""), null);
    // Se entra por el dominio propio pero APP_URL sigue en la dirección del servidor.
    assert.deepEqual(detectUrlMismatch("https://pizarro-prod.up.railway.app", "https://pizarro.example.com"), { current: "https://pizarro.example.com", app: "https://pizarro-prod.up.railway.app", kind: "own" });
    // Al revés: APP_URL es el dominio propio y se entra por la dirección del servidor.
    assert.equal(detectUrlMismatch("https://pizarro.example.com", "https://pizarro-prod.up.railway.app")?.kind, "other");
    // Local: localhost frente a 127.0.0.1.
    assert.deepEqual(detectUrlMismatch("http://localhost:3341", "http://127.0.0.1:3341"), { current: "http://127.0.0.1:3341", app: "http://localhost:3341", kind: "other" });
    // Otro protocolo con el mismo host también es distinto.
    assert.equal(detectUrlMismatch("https://pizarro.example.com", "http://pizarro.example.com")?.kind, "other");
  });
});
