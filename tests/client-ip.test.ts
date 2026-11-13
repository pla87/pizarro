// IP del cliente (lib/client-ip.ts, lib/peer-ip.ts y TRUST_PROXY): sin proxy de confianza no se puede falsear con
// X-Real-IP / X-Forwarded-For, y con proxy se sigue usando lo que dice el proxy (Docker con Caddy, Railway).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { clientIpFrom, PEER_IP_HEADER, PEER_IP_MARK, trustProxy, trustProxyInvalid } from "../src/lib/client-ip";
import { installPeerIpHeader } from "../src/lib/peer-ip";

test("TRUST_PROXY sin definir: se confía en el proxy en Docker y Railway, no con npm start ni a mano", () => {
  assert.equal(trustProxy({ PIZARRO_LAUNCHER: "docker" }), true);
  assert.equal(trustProxy({ RAILWAY_ENVIRONMENT: "production" }), true);
  assert.equal(trustProxy({ RAILWAY_PROJECT_ID: "x", PIZARRO_LAUNCHER: "docker" }), true);
  assert.equal(trustProxy({ PIZARRO_LAUNCHER: "npm" }), false);
  assert.equal(trustProxy({}), false);
});

test("TRUST_PROXY definida manda sobre el valor por defecto; un valor raro se avisa y no cambia nada", () => {
  for (const v of ["1", "true", " TRUE ", "yes", "on"]) assert.equal(trustProxy({ TRUST_PROXY: v, PIZARRO_LAUNCHER: "npm" }), true, v);
  for (const v of ["0", "false", "no", "off"]) {
    assert.equal(trustProxy({ TRUST_PROXY: v, PIZARRO_LAUNCHER: "docker" }), false, v);
    assert.equal(trustProxy({ TRUST_PROXY: v, RAILWAY_ENVIRONMENT: "production" }), false, v);
  }
  assert.equal(trustProxyInvalid({ TRUST_PROXY: "quizá" }), true);
  assert.equal(trustProxy({ TRUST_PROXY: "quizá", PIZARRO_LAUNCHER: "npm" }), false);
  assert.equal(trustProxy({ TRUST_PROXY: "quizá", PIZARRO_LAUNCHER: "docker" }), true);
  assert.equal(trustProxyInvalid({}), false);
  assert.equal(trustProxyInvalid({ TRUST_PROXY: "1" }), false);
});

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

test("sin proxy de confianza, X-Real-IP y X-Forwarded-For no cuentan: vale la dirección de la conexión", () => {
  const h = headers({ "x-real-ip": "10.0.0.1", "x-forwarded-for": "10.0.0.2, 10.0.0.3", [PEER_IP_HEADER]: "203.0.113.7" });
  assert.equal(clientIpFrom(h, { trusted: false, peerInstalled: true }), "203.0.113.7");
  // Si este proceso no anota la conexión, la cabecera interna también podría venir del cliente: no se sabe la IP.
  assert.equal(clientIpFrom(h, { trusted: false, peerInstalled: false }), null);
  assert.equal(clientIpFrom(headers({ [PEER_IP_HEADER]: "::ffff:198.51.100.4" }), { trusted: false, peerInstalled: true }), "198.51.100.4");
});

test("con proxy de confianza: X-Real-IP, o el último salto de X-Forwarded-For, o la conexión", () => {
  const opts = { trusted: true, peerInstalled: true };
  assert.equal(clientIpFrom(headers({ "x-real-ip": " 10.0.0.1 ", "x-forwarded-for": "10.0.0.2", [PEER_IP_HEADER]: "172.18.0.5" }), opts), "10.0.0.1");
  assert.equal(clientIpFrom(headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.3", [PEER_IP_HEADER]: "172.18.0.5" }), opts), "10.0.0.3");
  assert.equal(clientIpFrom(headers({ [PEER_IP_HEADER]: "172.18.0.5" }), opts), "172.18.0.5");
  assert.equal(clientIpFrom(headers({}), opts), null);
});

test("el servidor sustituye la cabecera interna que mande el cliente por la dirección real de la conexión", async () => {
  installPeerIpHeader();
  installPeerIpHeader(); // idempotente
  assert.equal((globalThis as Record<symbol, unknown>)[PEER_IP_MARK], true);
  const seen: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers[PEER_IP_HEADER] as string | undefined);
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as { port: number };
    await fetch(`http://127.0.0.1:${port}/`, { headers: { [PEER_IP_HEADER]: "6.6.6.6", "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6" } }).then((r) => r.text());
    await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  } finally {
    server.close();
  }
  assert.equal(seen.length, 2);
  for (const ip of seen) assert.match(ip ?? "", /^(::ffff:)?127\.0\.0\.1$/);
});

test("ningún otro módulo lee X-Real-IP ni X-Forwarded-For: todo pasa por clientIp (lib/request.ts)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk("src");
  const offenders = files.filter((f) => f !== path.join("src", "lib", "client-ip.ts") && /["'`]x-(real-ip|forwarded-for)["'`]/i.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
