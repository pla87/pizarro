// Informe de errores del navegador: con y sin sesión (la pantalla de acceso no tiene), límites y marca de anónimo.
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { db, loginAs, makeUser } from "./helpers";
import { POST } from "../../src/app/api/client-errors/route";
import { CHALLENGE_COOKIE } from "../../src/lib/two-factor";
import { DEVICE_COOKIE } from "../../src/lib/devices";
import { CHALLENGE_COOKIE_NAME, DEVICE_COOKIE_NAME } from "../../src/lib/reset-cookies";
import { flushLogs } from "../../src/lib/log";
import { resetRateLimit } from "../../src/lib/rate-limit";

const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;

function post(body: unknown, headers: Record<string, string> = {}) {
  const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  return POST(new Request(`${origin}/api/client-errors`, { method: "POST", headers: { origin, "x-real-ip": "10.9.8.7", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const report = (message: string) => ({ source: "global-error", message, path: "/login" });

beforeEach(async () => {
  jar.clear();
  resetRateLimit("client-errors:anon:10.9.8.7");
  resetRateLimit("client-errors:u:10.9.8.7");
  await db.appLog.deleteMany({ where: { category: "client" } });
});

describe("/api/client-errors", () => {
  test("sin sesión se registra, marcado como anónimo y sin usuario", async () => {
    const res = await post(report("fallo anónimo 1"));
    assert.equal(res.status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", message: { contains: "fallo anónimo 1" } } });
    assert.equal(row.userId, null);
    assert.equal(row.action, "client.global-error");
    assert.match(row.message, /sin sesión/);
    assert.equal((row.details as { anonymous: boolean }).anonymous, true);
  });

  test("con una cookie de sesión inventada (revocada) también se registra como anónimo", async () => {
    jar.set("tablon_session", "x".repeat(43));
    assert.equal((await post(report("fallo cookie vieja"))).status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", message: { contains: "fallo cookie vieja" } } });
    assert.equal((row.details as { anonymous: boolean }).anonymous, true);
  });

  test("con sesión se atribuye a la persona", async () => {
    const u = await makeUser();
    await loginAs(u);
    assert.equal((await post(report("fallo con sesión"))).status, 204);
    await flushLogs();
    const row = await db.appLog.findFirstOrThrow({ where: { category: "client", message: { contains: "fallo con sesión" } } });
    assert.equal(row.userId, u.id);
    assert.equal((row.details as { anonymous: boolean }).anonymous, false);
  });

  test("anónimo: límite por IP, cuerpo pequeño, origen y formato", async () => {
    // Cuerpo por encima del tope anónimo (8 KB) aunque quepa en el de sesión.
    assert.equal((await post({ ...report("x"), stack: "s".repeat(4000), path: "p".repeat(500), digest: "d".repeat(200), message: "m".repeat(2000) })).status, 204);
    assert.equal((await post(JSON.stringify({ ...report("y"), pad: "z".repeat(9000) }))).status, 413);
    assert.equal((await post("no es json")).status, 400);
    assert.equal((await post({ source: "otro", message: "m" })).status, 400);
    assert.equal((await post(report("z"), { origin: "https://evil.example.com" })).status, 403);
    resetRateLimit("client-errors:anon:10.9.8.7");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post(report(`rate ${i}`))).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(204));
    assert.deepEqual(statuses.slice(10), [429, 429]);
  });
});

test("la salida limpia borra las cookies con los nombres reales de verificación y dispositivo", () => {
  assert.equal(CHALLENGE_COOKIE_NAME, CHALLENGE_COOKIE);
  assert.equal(DEVICE_COOKIE_NAME, DEVICE_COOKIE);
});
