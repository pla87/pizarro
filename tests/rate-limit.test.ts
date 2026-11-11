import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loginRateKeys, rateIp, rateLimit, rateLimitReached, rateLimitRetryAfterSec, resetRateLimit } from "../src/lib/rate-limit";

test("rateLimit: el coste suma al contador (creaciones múltiples)", () => {
  const key = "test:cost";
  resetRateLimit(key);
  assert.equal(rateLimit(key, 10, 60_000, 6), true);
  assert.equal(rateLimit(key, 10, 60_000, 4), true);
  assert.equal(rateLimit(key, 10, 60_000), false);
  resetRateLimit(key);
  // Un solo golpe mayor que el límite se rechaza ya en la primera llamada.
  assert.equal(rateLimit(key, 10, 60_000, 11), false);
  resetRateLimit(key);
});

test("rateLimitRetryAfterSec: segundos hasta el reinicio de la ventana", () => {
  const key = "test:retry";
  resetRateLimit(key);
  assert.equal(rateLimitRetryAfterSec(key), 1);
  rateLimit(key, 1, 30_000);
  const s = rateLimitRetryAfterSec(key);
  assert.ok(s >= 29 && s <= 30);
  resetRateLimit(key);
});

test("rateIp: IPv6 agrupada por /64; IPv4 (también envuelta en IPv6) y valores raros tal cual", () => {
  assert.equal(rateIp("203.0.113.7"), "203.0.113.7");
  assert.equal(rateIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(rateIp("2001:0DB8:0001:0002:0000:0000:0000:0001"), "2001:db8:1:2::/64");
  assert.equal(rateIp("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(rateIp("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateIp("[2001:db8:1:2::5]"), "2001:db8:1:2::/64");
  assert.equal(rateIp("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(rateIp("::1"), "0:0:0:0::/64");
  assert.equal(rateIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(rateIp("::ffff:cb00:7107"), "203.0.113.7");
  assert.equal(rateIp("64:ff9b::203.0.113.7"), "64:ff9b:0:0::/64");
  // Dos direcciones del mismo /64 comparten límite; de otro /64, no.
  assert.equal(rateIp("2001:db8:1:2::a"), rateIp("2001:db8:1:2:ffff::b"));
  assert.notEqual(rateIp("2001:db8:1:2::a"), rateIp("2001:db8:1:3::a"));
  for (const raw of ["unknown", "", "1:2:3", "1::2::3", "zzzz::1", "1:2:3:4:5:6:7:8:9", "::ffff:999.1.1.1"]) assert.equal(rateIp(raw), raw.trim(), raw);
});

test("loginRateKeys: la clave por IP de una IPv6 es su /64", () => {
  assert.equal(loginRateKeys("2001:db8:1:2::77", "A@Example.com ").ip, "login:ip:2001:db8:1:2::/64");
  assert.equal(loginRateKeys("2001:db8:1:2::77", "A@Example.com ").account, "login:acct:a@example.com");
});

test("rateLimit: inundar claves normales no borra los bloqueos de seguridad (login, reset, 2fa…)", () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const locked = ["login:acct:victima@example.com", "reset:email:victima@example.com", "2fa:user:u1", "setup:fail:all"];
    for (const k of locked) {
      resetRateLimit(k);
      for (let i = 0; i < 6; i++) rateLimit(k, 6, 15 * 60_000);
      assert.equal(rateLimitReached(k, 6), true, k);
    }
    // 60.000 claves nuevas (p. ej. /api/client-errors desde muchas IP) y pasa más de un segundo: salta el tope duro.
    for (let i = 0; i < 60_000; i++) rateLimit(`client-errors:ip:198.51.${i >> 8}.${i & 255}-${i}`, 60, 60_000);
    now += 1500;
    rateLimit("client-errors:ip:192.0.2.1", 60, 60_000);
    // Las más antiguas de las normales se han descartado…
    assert.equal(rateLimitReached("client-errors:ip:198.51.0.0-0", 1), false);
    assert.equal(rateLimitReached("client-errors:ip:198.51.234.95-59999", 1), true);
    // …pero los bloqueos siguen ahí.
    for (const k of locked) assert.equal(rateLimitReached(k, 6), true, k);
  } finally {
    Date.now = realNow;
  }
});

test("rateLimit: los bloqueos de seguridad también se limpian al caducar", () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (let i = 0; i < 6000; i++) rateLimit(`login:acct:u${i}@example.com`, 6, 1000);
    now += 2000; // todas caducadas
    rateLimit("login:acct:nueva@example.com", 6, 60_000);
    assert.equal(rateLimitRetryAfterSec("login:acct:u0@example.com"), 1); // ya no existe
    assert.equal(rateLimitReached("login:acct:nueva@example.com", 1), true);
  } finally {
    Date.now = realNow;
  }
});

test("las claves por IP pasan por rateIp (IPv6 agrupada por /64), también las del webhook de Telegram", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "generated") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk("src");
  // Una IP sin agrupar en la clave: `${ip}`, `${clientIp(...)}`, `${req.ip}`…
  const raw = /rateLimit[A-Za-z]*\(\s*`[^`]*\$\{\s*(?:[\w.]*\bip|clientIp\([^)]*\))\s*\}/i;
  const offenders = files.filter((f) => raw.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
  assert.match(readFileSync("src/app/api/telegram/webhook/route.ts", "utf8"), /telegram:webhook:bad:\$\{rateIp\(ip\)\}/);
});
