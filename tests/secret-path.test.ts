import assert from "node:assert/strict";
import { test } from "node:test";
import { ifNoneMatchHas } from "../src/lib/etag";
import { maskSecretPaths, maskSecretsFor, secretOfPath, SECRET_PATH_PREFIXES } from "../src/lib/secret-path";

const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

test("maskSecretPaths: el calendario, /reset/ y /confirm/ quedan con «…» en lugar del token", () => {
  assert.equal(maskSecretPaths(`/api/calendar/${TOKEN}.ics`), "/api/calendar/…");
  assert.equal(maskSecretPaths("/api/calendar/lo-que-sea"), "/api/calendar/…");
  assert.equal(maskSecretPaths(`/api/calendar/${TOKEN}.ics?x=1`), "/api/calendar/…");
  assert.equal(maskSecretPaths(`/reset/${TOKEN}`), "/reset/…");
  assert.equal(maskSecretPaths(`/confirm/${TOKEN}`), "/confirm/…");
  assert.equal(maskSecretPaths(`/RESET/${TOKEN}`), "/RESET/…");
  // Idempotente y sin tocar el resto.
  assert.equal(maskSecretPaths("/api/calendar/…"), "/api/calendar/…");
  for (const p of ["/", "/login", "/p/abc?task=1", "/api/auth/reset", "/api/calendar", "/calendario/x"]) assert.equal(maskSecretPaths(p), p);
});

test("maskSecretPaths: también dentro de mensajes y direcciones completas, y escondido con %", () => {
  assert.equal(maskSecretPaths(`Error en GET /api/calendar/${TOKEN}.ics: boom`), "Error en GET /api/calendar/…: boom");
  assert.equal(maskSecretPaths(`fallo (https://app.example.com/reset/${TOKEN}) y más`), "fallo (https://app.example.com/reset/…) y más");
  assert.equal(maskSecretPaths(`/%72eset/${TOKEN}`), "/reset/…");
  assert.equal(maskSecretPaths("100% seguro /reset/%E0%A4%A"), "100% seguro /reset/…");
  assert.equal(maskSecretPaths(""), "");
});

test("maskSecretsFor enmascara además el propio secreto de la ruta aunque el mensaje lo cite suelto", () => {
  const path = `/api/calendar/${TOKEN}.ics`;
  const msg = maskSecretsFor(`no se pudo resolver ${TOKEN}.ics (${TOKEN})`, path);
  assert.ok(!msg.includes(TOKEN), msg);
  assert.equal(maskSecretsFor(path, path), "/api/calendar/…");
  // Rutas sin secreto: el texto queda igual (un trozo corto de ruta no se confunde con un secreto).
  assert.equal(maskSecretsFor("error en /login", "/login"), "error en /login");
  assert.equal(secretOfPath("/reset/abc12345?x=1"), "abc12345");
  assert.equal(secretOfPath("/p/abc"), null);
  assert.deepEqual([...SECRET_PATH_PREFIXES], ["/api/calendar/", "/reset/", "/confirm/", "/unsubscribe/", "/x/"]);
});

test("ifNoneMatchHas ignora el prefijo débil W/ en cualquiera de los dos lados y admite listas y *", () => {
  const etag = '"abc"';
  assert.equal(ifNoneMatchHas('"abc"', etag), true);
  assert.equal(ifNoneMatchHas('W/"abc"', etag), true);
  assert.equal(ifNoneMatchHas('"x", W/"abc"', etag), true);
  assert.equal(ifNoneMatchHas("*", etag), true);
  assert.equal(ifNoneMatchHas('"abd"', etag), false);
  assert.equal(ifNoneMatchHas('W/"abd"', etag), false);
  assert.equal(ifNoneMatchHas(null, etag), false);
  assert.equal(ifNoneMatchHas("", etag), false);
  assert.equal(ifNoneMatchHas('"abc"', 'W/"abc"'), true);
});

test("redactPath y maskSecretPaths ocultan el token de los enlaces de baja de emails", async () => {
  const { redactPath } = await import("../src/lib/redact-path");
  assert.equal(redactPath("/unsubscribe/m1abc.def?x=1"), "/unsubscribe/…");
  assert.equal(redactPath("/api/unsubscribe/m1abc.def"), "/api/unsubscribe/…");
  assert.ok(!maskSecretPaths("fallo en /unsubscribe/m1abc.def: timeout").includes("m1abc"));
  assert.ok(!maskSecretPaths("POST /api/unsubscribe/m1abc.def").includes("m1abc"));
});

test("«Compartir fuera»: /x/<token> y lo que cuelga (descargas, acciones) nunca llegan enteros al registro", async () => {
  const { redactPath } = await import("../src/lib/redact-path");
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
  assert.equal(redactPath(`/x/${token}`), "/x/…");
  assert.equal(redactPath(`/x/${token}/a/att1?inline=1`), "/x/…/a/att1");
  assert.equal(maskSecretPaths(`GET /x/${token}/t/abc: fallo`), "GET /x/…: fallo");
  assert.equal(secretOfPath(`/x/${token}/a/att1`), token, "el secreto es el primer tramo");
  assert.ok(!maskSecretsFor(`no se pudo con ${token}`, `/x/${token}/a/att1`).includes(token));
});
