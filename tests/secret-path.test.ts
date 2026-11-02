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
  assert.deepEqual([...SECRET_PATH_PREFIXES], ["/api/calendar/", "/reset/", "/confirm/"]);
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
