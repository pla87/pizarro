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

test("compartir con los miembros: los permisos de Drive se piden de 5 en 5, no todos a la vez", async () => {
  const { shareFile } = await import("../src/lib/google");
  const realFetch = globalThis.fetch;
  let active = 0;
  let peak = 0;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const emails = Array.from({ length: 12 }, (_, i) => `p${i}@example.com`);
    const out = await shareFile("token", "file1", { type: "users", emails }, "writer");
    assert.equal(calls, 12);
    assert.equal(peak, 5);
    assert.equal(out.failed, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("compartir con Drive colgado: un plazo para todo el reparto; lo que queda sin pedir cuenta como fallido", async () => {
  const { shareFile } = await import("../src/lib/google");
  const realFetch = globalThis.fetch;
  let calls = 0;
  // Drive no contesta: cada petición solo termina cuando se corta.
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    calls++;
    return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  // Los plazos son AbortSignal.timeout, que no mantienen vivo el proceso: sin otro temporizador en marcha (en CI no hay
  // nada más), Node se queda sin tareas antes de que salten y cancela la prueba. En el servidor siempre hay algo vivo.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const emails = Array.from({ length: 12 }, (_, i) => `p${i}@example.com`);
    const started = Date.now();
    const out = await shareFile("token", "file1", { type: "users", emails }, "writer", 50);
    assert.ok(Date.now() - started < 2000, "no espera 10 s por tanda");
    assert.equal(calls, 5, "solo la primera tanda llega a pedirse");
    assert.deepEqual(out, { status: "NOT_SHARED", failed: 12 });
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = realFetch;
  }
});
