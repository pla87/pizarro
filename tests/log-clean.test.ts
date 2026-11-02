// Registro de actividad: textos que PostgreSQL acepta (sin NUL ni medio emoji) y qué errores se reintentan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, clipText, isConnectionError } from "../src/lib/log-clean";

test("cleanText quita los NUL y cambia las mitades sueltas de emoji por «�», sin tocar los emojis completos", () => {
  assert.equal(cleanText("a\u0000b\u0000"), "ab");
  assert.equal(cleanText("x\ud83d"), "x�");
  assert.equal(cleanText("\ude00y"), "�y");
  assert.equal(cleanText("ok 😀 ñ"), "ok 😀 ñ");
  assert.equal(cleanText(""), "");
});

test("clipText recorta sin partir un emoji por la mitad", () => {
  assert.equal(clipText("a😀b", 2), "a"); // el emoji ocupa las posiciones 1 y 2: no cabe entero
  assert.equal(clipText("a😀b", 3), "a😀");
  assert.equal(clipText("abc", 5), "abc");
  assert.equal(clipText("\u0000abc", 2), "ab"); // primero se limpia, luego se recorta
  assert.ok(clipText("😀".repeat(300), 501).isWellFormed());
  assert.equal(clipText("😀".repeat(300), 501).length, 500);
});

const adapterError = (cause: Record<string, unknown>, code = "P2039") =>
  Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code, meta: { driverAdapterError: { name: "DriverAdapterError", cause } } });

test("isConnectionError: los datos rechazados no se reintentan; la conexión caída sí", () => {
  // Datos: NUL en text (22021), NUL en jsonb (22P05), medio emoji en jsonb (22P02), valor demasiado largo.
  assert.equal(isConnectionError(adapterError({ kind: "postgres", originalCode: "22021" })), false);
  assert.equal(isConnectionError(adapterError({ kind: "postgres", originalCode: "22P05" })), false);
  assert.equal(isConnectionError(adapterError({ kind: "InvalidInputValue", originalCode: "22P02" }, "P2007")), false);
  assert.equal(isConnectionError(Object.assign(new Error("x"), { name: "PrismaClientValidationError" })), false);
  assert.equal(isConnectionError(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P2000" })), false);
  // Conexión o servidor.
  assert.equal(isConnectionError(adapterError({ kind: "DatabaseNotReachable", host: "127.0.0.1", port: 5432 }, "P1001")), true);
  assert.equal(isConnectionError(adapterError({ kind: "AuthenticationFailed", originalCode: "28P01" }, "P1000")), true);
  assert.equal(isConnectionError(adapterError({ kind: "TooManyConnections" }, "P2037")), true);
  assert.equal(isConnectionError(adapterError({ kind: "postgres", originalCode: "57P01" })), true); // admin_shutdown
  assert.equal(isConnectionError(adapterError({ kind: "postgres", originalCode: "53100" })), true); // disco lleno
  assert.equal(isConnectionError(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: "P1017" })), true);
  assert.equal(isConnectionError(Object.assign(new Error("x"), { name: "PrismaClientInitializationError" })), true);
  assert.equal(isConnectionError(new Error("Connection terminated due to connection timeout")), true);
  assert.equal(isConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
});
