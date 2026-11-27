// Ronda 71: el aviso del proxy con el cambio de contraseña pendiente sale en el idioma del navegador.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { PASSWORD_CHANGE_COOKIE, sessionCookieName } from "../src/lib/session-config";

async function call(acceptLanguage?: string) {
  const headers: Record<string, string> = { cookie: `${sessionCookieName()}=tok; ${PASSWORD_CHANGE_COOKIE}=1` };
  if (acceptLanguage) headers["accept-language"] = acceptLanguage;
  const res = await proxy(new NextRequest("http://localhost/api/tasks", { method: "POST", headers }));
  return { status: res.status, body: (await res.json()) as { error: string } };
}

test("contraseña nueva pendiente: el error va en español o en inglés según Accept-Language", async () => {
  assert.deepEqual(await call(), { status: 403, body: { error: "Debes elegir una contraseña nueva" } });
  assert.deepEqual(await call("es-ES,es;q=0.9"), { status: 403, body: { error: "Debes elegir una contraseña nueva" } });
  assert.deepEqual(await call("en-US,en;q=0.9"), { status: 403, body: { error: "You must choose a new password" } });
});
