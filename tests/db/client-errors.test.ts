// Informe de errores del navegador: con y sin sesión (la pantalla de acceso no tiene), límites y marca de anónimo.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { db, loginAs, makeUser } from "./helpers";
import { POST } from "../../src/app/api/client-errors/route";
import { CHALLENGE_COOKIE } from "../../src/lib/two-factor";
import { CHALLENGE_COOKIE_NAME } from "../../src/lib/reset-cookies";
import { flushLogs } from "../../src/lib/log";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { rejectionFromApp, windowErrorFromApp } from "../../src/lib/client-error-origin";
import { logWhere, parseLogFilters } from "../../src/lib/log-query";

const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;

function post(body: unknown, headers: Record<string, string> = {}) {
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  return POST(new Request(`${origin}/api/client-errors`, { method: "POST", headers: { origin, "x-real-ip": "10.9.8.7", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const report = (message: string) => ({ source: "global-error", message, path: "/login" });

beforeEach(async () => {
  jar.clear();
  resetRateLimit("client-errors:ip:10.9.8.7");
  resetRateLimit("client-errors:anon:10.9.8.7");
  resetRateLimit("client-errors:u:10.9.8.7");
  resetRateLimit("client-errors:anon:all");
  await db.appLog.deleteMany({ where: { category: "client" } });
});

describe("/api/client-errors", () => {
  test("sin sesión se registra, marcado como anónimo y sin usuario", async () => {
    const res = await post(report("fallo anónimo 1"));
    assert.equal(res.status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", details: { path: ["error"], string_contains: "fallo anónimo 1" } } });
    assert.equal(row.userId, null);
    assert.equal(row.action, "client.global-error");
    // Frase llana con la ruta; el texto técnico, en los detalles.
    assert.equal(row.message, "Error en el navegador (sin sesión) en /login");
    assert.equal((row.details as { error: string }).error, "fallo anónimo 1");
    assert.equal((row.details as { anonymous: boolean }).anonymous, true);
  });

  test("con una cookie de sesión inventada (revocada) también se registra como anónimo", async () => {
    jar.set("tablon_session", "x".repeat(43));
    assert.equal((await post(report("fallo cookie vieja"))).status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", details: { path: ["error"], string_contains: "fallo cookie vieja" } } });
    assert.equal((row.details as { anonymous: boolean }).anonymous, true);
  });

  test("la ruta se guarda sin tokens de un solo uso ni query", async () => {
    const res = await post({ source: "window", message: "fallo ruta redactada", path: "/reset/AbCdEf123456?code=zzz&state=yyy" });
    assert.equal(res.status, 204);
    await post({ source: "window", message: "fallo ruta confirm", path: "/confirm/SECRETTOKEN" });
    await flushLogs();
    const a = await db.appLog.findFirstOrThrow({ where: { category: "client", details: { path: ["error"], string_contains: "fallo ruta redactada" } } });
    assert.equal(a.path, "/reset/…");
    assert.ok(!JSON.stringify(a).includes("AbCdEf") && !JSON.stringify(a).includes("zzz"));
    const b = await db.appLog.findFirstOrThrow({ where: { category: "client", details: { path: ["error"], string_contains: "fallo ruta confirm" } } });
    assert.equal(b.path, "/confirm/…");
  });

  test("con sesión se atribuye a la persona", async () => {
    const u = await makeUser();
    await loginAs(u);
    assert.equal((await post(report("fallo con sesión"))).status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", details: { path: ["error"], string_contains: "fallo con sesión" } } });
    assert.equal(row.userId, u.id);
    assert.equal(row.message, "Error en el navegador en /login");
    assert.equal((row.details as { anonymous: boolean }).anonymous, false);
  });

  test("anónimo: límite por IP, cuerpo pequeño, origen y formato", async () => {
    // Cuerpo por encima del tope anónimo (8 KB) aunque quepa en el de sesión.
    assert.equal((await post({ ...report("x"), stack: "s".repeat(4000), path: "p".repeat(500), digest: "d".repeat(200), message: "m".repeat(2000) })).status, 204);
    assert.equal((await post(JSON.stringify({ ...report("y"), pad: "z".repeat(9000) }))).status, 413);
    assert.equal((await post("no es json")).status, 400);
    assert.equal((await post({ source: "otro", message: "m" })).status, 400);
    assert.equal((await post(report("z"), { origin: "https://evil.example.com" })).status, 403);
    resetRateLimit("client-errors:ip:10.9.8.7");
  resetRateLimit("client-errors:anon:10.9.8.7");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post(report(`rate ${i}`))).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(204));
    assert.deepEqual(statuses.slice(10), [429, 429]);
  });

  test("anónimo: tope global de 120 por minuto aunque cada IP vaya por debajo de su límite", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) {
      const ip = `10.77.0.${i + 1}`;
      for (let j = 0; j < 10; j++) statuses.push((await post(report(`global ${i}-${j}`), { "x-real-ip": ip })).status);
    }
    assert.deepEqual(statuses.slice(0, 120), Array(120).fill(204));
    assert.deepEqual(statuses.slice(120), Array(10).fill(429));
    // Con sesión no cuenta para ese tope.
    await loginAs(await makeUser());
    assert.equal((await post(report("con sesión tras el tope"), { "x-real-ip": "10.77.1.1" })).status, 204);
    for (let i = 0; i < 13; i++) {
      resetRateLimit(`client-errors:ip:10.77.0.${i + 1}`);
      resetRateLimit(`client-errors:anon:10.77.0.${i + 1}`);
    }
    resetRateLimit("client-errors:anon:all");
  });

  test("las redirecciones y los «no encontrado» de Next que llegan a medio enviar la página no se registran", async () => {
    const minified = "Minified React error #419; visit https://react.dev/errors/419 for the full message";
    for (const digest of ["NEXT_REDIRECT;replace;/admin/users;307;", "NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_NOT_FOUND"]) {
      assert.equal((await post({ source: "window", message: minified, digest, path: "/admin" })).status, 204);
    }
    // En desarrollo llega el mensaje sin minificar y sin digest.
    assert.equal((await post({ source: "window", message: "NEXT_REDIRECT", path: "/admin" })).status, 204);
    // Un #419 de verdad (otro digest) sí se registra.
    assert.equal((await post({ source: "window", message: minified, digest: "3891245", path: "/admin" })).status, 204);
    await flushLogs();
    const rows = await db.appLog.findMany({ where: { category: "client", path: "/admin" }, select: { details: true } });
    assert.deepEqual(rows.map((r) => (r.details as { digest?: string }).digest), ["3891245"]);
  });
});

describe("errores de ventana sin capturar (client.window)", () => {
  const origin = "https://pizarro.example.com";
  const appError = (where: string) => Object.assign(new Error("fallo"), { stack: `Error: fallo\n    at save (${where}:1:200)` });
  test("los de una extensión o un script ajeno se descartan; los de la app, no", () => {
    // De la app: en sus scripts de /_next/ o en un script en línea de la página.
    assert.equal(windowErrorFromApp({ filename: `${origin}/_next/static/chunks/app-1234.js`, error: appError(`${origin}/_next/static/chunks/app-1234.js`) }, origin), true);
    assert.equal(windowErrorFromApp({ filename: `${origin}/p/abc`, error: null }, origin), true);
    // Saltó en un script de otro origen al que llamó la app: la pila pasa por la app.
    assert.equal(windowErrorFromApp({ filename: "https://cdn.example.net/lib.js", error: Object.assign(new Error("x"), { stack: `Error: x\n    at f (https://cdn.example.net/lib.js:1:1)\n    at g (${origin}/_next/static/chunks/a.js:2:3)` }) }, origin), true);
    // Extensiones de Chrome, Firefox y Safari (aunque su pila mencione la app).
    for (const file of ["chrome-extension://abcdef/content.js", "moz-extension://1234-5678/inject.js", "safari-web-extension://ABCD/script.js"]) {
      assert.equal(windowErrorFromApp({ filename: file, error: appError(file) }, origin), false, file);
    }
    assert.equal(windowErrorFromApp({ filename: "chrome-extension://abcdef/content.js", error: appError(`${origin}/_next/static/chunks/a.js`) }, origin), false);
    // Sin fichero («Script error.» de un script de otro origen, la consola) ni pila de la app.
    assert.equal(windowErrorFromApp({ filename: "", error: null }, origin), false);
    assert.equal(windowErrorFromApp({ filename: "https://otra.example.com/_next/static/chunks/a.js", error: appError("https://otra.example.com/_next/static/chunks/a.js") }, origin), false);
    assert.equal(windowErrorFromApp({}, origin), false);
  });
});

describe("rechazos de promesas sin capturar (client.promise)", () => {
  const origin = "https://pizarro.example.com";
  test("solo los de los scripts de la app: con un fichero del propio origen bajo /_next/ en la pila", () => {
    const app = new Error("fallo de la app");
    app.stack = `Error: fallo de la app\n    at save (${origin}/_next/static/chunks/app-1234.js:1:200)`;
    assert.equal(rejectionFromApp(app, origin), true);
    // Firefox y Safari escriben la pila de otra forma.
    assert.equal(rejectionFromApp({ stack: `save@${origin}/_next/static/chunks/a.js:1:2` }, origin), true);
    // Desde la consola o un script ajeno: sin pila de la app.
    const junk = new TypeError("Junk found after end of compressed data.");
    junk.stack = "TypeError: Junk found after end of compressed data.";
    assert.equal(rejectionFromApp(junk, origin), false);
    const ext = new Error("x");
    ext.stack = "Error: x\n    at chrome-extension://abcdef/content.js:3:4";
    assert.equal(rejectionFromApp(ext, origin), false);
    // Otro origen con /_next/ (una web incrustada) tampoco; ni un motivo que no es un error.
    assert.equal(rejectionFromApp({ stack: "at https://otra.example.com/_next/static/chunks/a.js:1:2" }, origin), false);
    assert.equal(rejectionFromApp("texto", origin), false);
    assert.equal(rejectionFromApp(undefined, origin), false);
  });

  test("el buscador de Logs encuentra un error del navegador por su texto técnico (va en los detalles)", async () => {
    assert.equal((await post({ source: "promise", message: "fallo buscable 42%", path: "/p/abc" })).status, 204);
    await flushLogs();
    const rows = await db.appLog.findMany({ where: logWhere(parseLogFilters({ q: "buscable 42%" }), []) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.message, "Error en el navegador (sin sesión) en /p/abc");
    assert.equal(await db.appLog.count({ where: logWhere(parseLogFilters({ q: "buscable 4_" }), []) }), 0);
  });
});

test("la salida limpia borra la cookie de verificación con su nombre real", () => {
  assert.equal(CHALLENGE_COOKIE_NAME, CHALLENGE_COOKIE);
});
