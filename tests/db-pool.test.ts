// Pool de PostgreSQL de la app (lib/db.ts → lib/db-pool.ts): tope de conexión, tamaño validado y mensaje claro.
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";
import pg from "pg";
import { dbConnectErrorMessage, dbPoolConfig, dbTarget, DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_POOL_SIZE } from "../src/lib/db-pool";

test("sin variables: 10 conexiones y 10 s de tope para conectar", () => {
  assert.deepEqual(dbPoolConfig({}), { max: DEFAULT_POOL_SIZE, connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS, warnings: [] });
  assert.equal(DEFAULT_CONNECT_TIMEOUT_MS, 10_000);
  assert.deepEqual(dbPoolConfig({ DATABASE_POOL_SIZE: " ", DATABASE_CONNECT_TIMEOUT_MS: "" }).warnings, []);
});

test("DATABASE_POOL_SIZE y DATABASE_CONNECT_TIMEOUT_MS válidos se usan", () => {
  const c = dbPoolConfig({ DATABASE_POOL_SIZE: " 25 ", DATABASE_CONNECT_TIMEOUT_MS: "3000" });
  assert.equal(c.max, 25);
  assert.equal(c.connectionTimeoutMillis, 3000);
  assert.deepEqual(c.warnings, []);
});

test("un valor que no es un entero razonable: aviso y valor por defecto (antes NaN = pool sin límite)", () => {
  for (const bad of ["diez", "0", "-3", "2.5", "1e3", "9999", "10 conexiones"]) {
    const c = dbPoolConfig({ DATABASE_POOL_SIZE: bad });
    assert.equal(c.max, DEFAULT_POOL_SIZE, bad);
    assert.equal(c.warnings.length, 1, bad);
    assert.match(c.warnings[0]!, /DATABASE_POOL_SIZE/);
  }
  for (const bad of ["10s", "0", "50", "999999999"]) {
    const c = dbPoolConfig({ DATABASE_CONNECT_TIMEOUT_MS: bad });
    assert.equal(c.connectionTimeoutMillis, DEFAULT_CONNECT_TIMEOUT_MS, bad);
    assert.match(c.warnings[0] ?? "", /DATABASE_CONNECT_TIMEOUT_MS/, bad);
  }
});

test("el mensaje del log dice qué servidor y por qué, sin usuario ni contraseña", () => {
  const url = "postgresql://pizarro:s3creta@db.example.com:5433/pizarro?sslmode=require";
  assert.equal(dbTarget(url), "db.example.com:5433, base pizarro");
  const timeout = dbConnectErrorMessage(new Error("timeout exceeded when trying to connect"), url, 10_000);
  assert.match(timeout, /No se puede conectar con PostgreSQL \(db\.example\.com:5433, base pizarro\): no ha respondido en 10 s/);
  assert.doesNotMatch(timeout, /s3creta|pizarro:/);
  assert.match(dbConnectErrorMessage(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), url, 10_000), /rechazado la conexión/);
  assert.match(dbConnectErrorMessage(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }), url, 10_000), /no se encuentra el servidor/);
  assert.equal(dbTarget("no es una url"), "DATABASE_URL no válida");
});

test("con ese tope, un servidor que acepta la conexión y no contesta da error en vez de colgar", async () => {
  // Simula una base de datos colgada (o un cortafuegos que deja pasar el SYN y se calla): acepta y nunca responde.
  const sockets: Socket[] = [];
  const server = createServer((s) => void sockets.push(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const pool = new pg.Pool({ connectionString: `postgresql://x:y@127.0.0.1:${port}/z`, connectionTimeoutMillis: 300, max: 1 });
  try {
    const start = performance.now();
    await assert.rejects(pool.query("SELECT 1"), (err: Error) => /timeout/i.test(err.message));
    assert.ok(performance.now() - start < 5000);
  } finally {
    await pool.end().catch(() => undefined);
    for (const s of sockets) s.destroy();
    server.close();
  }
});
