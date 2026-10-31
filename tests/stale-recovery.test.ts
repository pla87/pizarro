// Recuperación tras un despliegue: acciones de formularios de acceso, rutas públicas del proxy y cookies que borra la salida limpia.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { guardFormAction } from "../src/lib/guard-action";
import { proxy } from "../src/proxy";
import { CHALLENGE_COOKIE_NAME, DEVICE_COOKIE_NAME, clearAuthCookieHeaders } from "../src/lib/reset-cookies";
import { isStaleActionError } from "../src/lib/stale-action";

const t = (s: string) => s;
type S = { error?: string };

test("guardFormAction: una acción que ya no existe en el servidor recarga y avisa", async () => {
  let reloads = 0;
  const stale = new Error('Server Action "40abc" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action');
  assert.ok(isStaleActionError(stale));
  const guarded = guardFormAction<S>(async () => { throw stale; }, t, () => { reloads++; return true; });
  const out = await guarded({}, new FormData());
  assert.equal(reloads, 1);
  assert.match(out.error ?? "", /versión nueva/);
});

test("guardFormAction: errores normales dan el mensaje genérico, las redirecciones de Next se propagan y el resultado normal pasa", async () => {
  const boom = guardFormAction<S>(async () => { throw new Error("boom"); }, t, () => { throw new Error("no debe recargar"); });
  assert.match((await boom({}, new FormData())).error ?? "", /Error inesperado/);
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login/verify;303;" });
  await assert.rejects(guardFormAction<S>(async () => { throw redirect; }, t, () => true)({}, new FormData()), (e) => e === redirect);
  assert.deepEqual(await guardFormAction<S>(async () => ({ error: "Credenciales" }), t, () => true)({}, new FormData()), { error: "Credenciales" });
});

function req(path: string, cookie = "", method = "POST") {
  return new NextRequest(`http://localhost:3000${path}`, { method, headers: cookie ? { cookie } : {} });
}

test("proxy: informe de errores, versión y salida limpia son públicos; el resto de la API sigue pidiendo sesión", () => {
  for (const cookie of ["", "pz_pwchange=1", "tablon_session=" + "x".repeat(43) + "; pz_pwchange=1"]) {
    for (const path of ["/api/client-errors", "/api/version", "/api/auth/reset"]) {
      const res = proxy(req(path, cookie));
      assert.notEqual(res.status, 401, `${path} (${cookie})`);
      assert.notEqual(res.status, 403, `${path} (${cookie})`);
      assert.equal(res.headers.get("x-middleware-next"), "1", `${path} (${cookie})`);
    }
  }
  assert.equal(proxy(req("/api/tasks/abc")).status, 401);
});

test("proxy: sin cookie de sesión, o con la marca de cambio de contraseña, las páginas de acceso siguen siendo accesibles", () => {
  for (const cookie of ["", "pz_pwchange=1", "pz_2fa=" + "y".repeat(43)]) {
    for (const path of ["/login", "/login/verify"]) assert.equal(proxy(req(path, cookie, "GET")).headers.get("x-middleware-next"), "1");
  }
});

test("salida limpia: borra sesión, cambio de contraseña pendiente, verificación y dispositivo, con los atributos de las originales", () => {
  const saved = { s: process.env.COOKIE_SECURE };
  try {
    process.env.COOKIE_SECURE = "true";
    const secure = clearAuthCookieHeaders();
    assert.equal(secure.length, 4);
    for (const h of secure) assert.match(h, /Max-Age=0.*; HttpOnly; SameSite=Lax; Secure$/);
    assert.ok(secure.some((h) => h.startsWith("__Host-tablon_session=;")));
    process.env.COOKIE_SECURE = "false";
    const plain = clearAuthCookieHeaders();
    assert.ok(plain.some((h) => h.startsWith("tablon_session=;")));
    for (const h of plain) assert.doesNotMatch(h, /Secure/);
    for (const n of ["pz_pwchange", CHALLENGE_COOKIE_NAME, DEVICE_COOKIE_NAME]) assert.ok(plain.some((h) => h.startsWith(`${n}=;`)), n);
  } finally {
    if (saved.s === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = saved.s;
  }
});
