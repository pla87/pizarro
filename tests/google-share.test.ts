// Cómo se comparten los Docs/Sheets según el modo del proyecto (lógica pura, sin red).
import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveShareMode, shareRule, shareStatusOf } from "../src/lib/google-share";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { sharePermissionBodies } = await import("../src/lib/google");

const domain = "empresa.com";
const bodiesFor = (mode: string | null, isPrivate: boolean, emails = ["a@x.com", "B@x.com"], envRole?: string) => {
  const rule = shareRule(mode, isPrivate, { role: envRole });
  if (rule.scope === "none") return [];
  return sharePermissionBodies(rule.scope === "domain" ? { type: "domain" } : { type: "users", emails }, { domain, role: rule.role });
};

test("modo DOMAIN_WRITE y DOMAIN_READ: un permiso de dominio con su rol", () => {
  assert.deepEqual(bodiesFor("DOMAIN_WRITE", false), [{ type: "domain", domain, role: "writer" }]);
  assert.deepEqual(bodiesFor("DOMAIN_READ", false), [{ type: "domain", domain, role: "reader" }]);
});

test("modo MEMBERS: un permiso de editor por persona, sin duplicados; NONE: ninguno", () => {
  assert.deepEqual(bodiesFor("MEMBERS", false, ["a@x.com", "A@x.com", "b@x.com"]), [
    { type: "user", emailAddress: "a@x.com", role: "writer" },
    { type: "user", emailAddress: "b@x.com", role: "writer" },
  ]);
  assert.deepEqual(bodiesFor("NONE", false), []);
  assert.deepEqual(bodiesFor("MEMBERS", false, []), []);
});

test("un proyecto privado nunca comparte con el dominio, aunque tenga un modo de dominio guardado", () => {
  for (const mode of ["DOMAIN_WRITE", "DOMAIN_READ", "MEMBERS"]) {
    const bodies = bodiesFor(mode, true);
    assert.ok(bodies.length === 2 && bodies.every((b) => b.type === "user" && b.role === "writer"), mode);
  }
  assert.deepEqual(bodiesFor("NONE", true), []);
});

test("sin modo guardado se mantiene el comportamiento de GOOGLE_SHARE_ROLE", () => {
  assert.deepEqual(bodiesFor(null, false), [{ type: "domain", domain, role: "writer" }]);
  assert.deepEqual(bodiesFor(null, false, [], "commenter"), [{ type: "domain", domain, role: "commenter" }]);
  assert.deepEqual(bodiesFor(null, false, [], "reader"), [{ type: "domain", domain, role: "reader" }]);
  assert.deepEqual(bodiesFor(null, false, [], "none"), []);
  assert.equal(bodiesFor(null, true, ["a@x.com"], "reader")[0]?.role, "reader");
  assert.deepEqual(bodiesFor(null, true, ["a@x.com"], "none"), []);
  // Un valor desconocido del servidor tampoco comparte.
  assert.deepEqual(bodiesFor("BASURA", false, [], "otro"), []);
});

test("sin dominio configurado un modo de dominio no crea permisos", () => {
  assert.deepEqual(sharePermissionBodies({ type: "domain" }, { role: "writer" }), []);
});

test("effectiveShareMode refleja lo que hace hoy el servidor", () => {
  assert.equal(effectiveShareMode(null, false), "DOMAIN_WRITE");
  assert.equal(effectiveShareMode(null, false, { role: "reader" }), "DOMAIN_READ");
  assert.equal(effectiveShareMode(null, false, { role: "none" }), "NONE");
  assert.equal(effectiveShareMode(null, true), "MEMBERS");
  assert.equal(effectiveShareMode("DOMAIN_READ", true), "MEMBERS");
  assert.equal(effectiveShareMode("NONE", false), "NONE");
});

test("shareStatusOf: nada que compartir o todo fallido = no compartido; algún fallo = parcial", () => {
  assert.equal(shareStatusOf(0, 0), "NOT_SHARED");
  assert.equal(shareStatusOf(1, 1), "NOT_SHARED");
  assert.equal(shareStatusOf(3, 3), "NOT_SHARED");
  assert.equal(shareStatusOf(3, 1), "PARTIAL");
  assert.equal(shareStatusOf(3, 0), "SHARED");
});
