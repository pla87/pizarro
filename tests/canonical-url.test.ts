// Redirección opcional al dominio canónico (APP_URL).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalRedirect } from "../src/lib/canonical-url";

const base = { enabled: "1", appUrl: "https://pizarro.example.com", host: "pizarro-prod.up.railway.app", method: "GET", pathname: "/board/1", search: "?a=1&b=2" };

describe("redirección al dominio canónico", () => {
  test("otro host: 308 a APP_URL con ruta y consulta", () => {
    assert.equal(canonicalRedirect(base), "https://pizarro.example.com/board/1?a=1&b=2");
    assert.equal(canonicalRedirect({ ...base, appUrl: "https://pizarro.example.com/", pathname: "/", search: "" }), "https://pizarro.example.com/");
  });
  test("desactivada o sin APP_URL no hace nada", () => {
    assert.equal(canonicalRedirect({ ...base, enabled: undefined }), null);
    assert.equal(canonicalRedirect({ ...base, enabled: "0" }), null);
    assert.equal(canonicalRedirect({ ...base, appUrl: "" }), null);
    assert.equal(canonicalRedirect({ ...base, appUrl: "no es una url" }), null);
  });
  test("el host canónico (sin importar mayúsculas) no redirige", () => {
    assert.equal(canonicalRedirect({ ...base, host: "pizarro.example.com" }), null);
    assert.equal(canonicalRedirect({ ...base, host: "Pizarro.Example.com" }), null);
  });
  test("no toca peticiones internas, la API ni las que no son GET/HEAD", () => {
    assert.equal(canonicalRedirect({ ...base, host: "localhost:3000" }), null);
    assert.equal(canonicalRedirect({ ...base, host: "127.0.0.1:3000" }), null);
    assert.equal(canonicalRedirect({ ...base, host: null }), null);
    assert.equal(canonicalRedirect({ ...base, pathname: "/api/health" }), null);
    assert.equal(canonicalRedirect({ ...base, method: "POST" }), null);
    assert.equal(canonicalRedirect({ ...base, method: "HEAD" }), "https://pizarro.example.com/board/1?a=1&b=2");
  });
});

test("con x-forwarded-host se compara ese (el primero), no Host", () => {
  const internal = { ...base, host: "10.0.0.5:3000" };
  assert.equal(canonicalRedirect({ ...internal, forwardedHost: "pizarro.example.com" }), null);
  assert.equal(canonicalRedirect({ ...internal, forwardedHost: "pizarro.example.com, proxy.interno" }), null);
  assert.equal(canonicalRedirect({ ...internal, forwardedHost: "pizarro-prod.up.railway.app" }), "https://pizarro.example.com/board/1?a=1&b=2");
  assert.equal(canonicalRedirect({ ...base, host: "pizarro.example.com", forwardedHost: "otro.up.railway.app" }), "https://pizarro.example.com/board/1?a=1&b=2");
  assert.equal(canonicalRedirect({ ...base, forwardedHost: "localhost:3000" }), null);
  assert.equal(canonicalRedirect({ ...base, forwardedHost: "" }), "https://pizarro.example.com/board/1?a=1&b=2");
});
