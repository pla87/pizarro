// APP_URL (src/lib/app-url.ts): sin la variable, en Railway se usa https://<RAILWAY_PUBLIC_DOMAIN>, en un solo sitio para
// el servidor, el arranque (enlace de /setup), los emails y los scripts (reset-link, doctor).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAppUrlFallback, resolveAppUrl } from "../src/lib/app-url";

test("resolveAppUrl: la variable manda; sin ella, el dominio público de Railway; si no, ninguna", () => {
  assert.deepEqual(resolveAppUrl({ APP_URL: "https://pizarro.example.com", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }), { url: "https://pizarro.example.com", source: "env" });
  assert.deepEqual(resolveAppUrl({ RAILWAY_PUBLIC_DOMAIN: "pizarro-production.up.railway.app" }), { url: "https://pizarro-production.up.railway.app", source: "railway" });
  assert.deepEqual(resolveAppUrl({ APP_URL: "  ", RAILWAY_PUBLIC_DOMAIN: "Pizarro.Example.com." }), { url: "https://pizarro.example.com", source: "railway" });
  assert.deepEqual(resolveAppUrl({}), { url: null, source: "none" });
  // Un valor que no es un nombre de host (con esquema, ruta, puerto o sin punto) no se usa.
  for (const bad of ["https://x.up.railway.app", "x.up.railway.app/ruta", "x.up.railway.app:443", "localhost", "a b.example.com"]) assert.equal(resolveAppUrl({ RAILWAY_PUBLIC_DOMAIN: bad }).source, "none", bad);
});

test("applyAppUrlFallback: la fija para todo el proceso (y sus hijos), lo dice una vez, y luego sigue diciendo de dónde salió", () => {
  const env: Record<string, string | undefined> = { RAILWAY_PUBLIC_DOMAIN: "pizarro-production.up.railway.app" };
  const lines: string[] = [];
  assert.equal(applyAppUrlFallback(env, (m) => lines.push(m)), "railway");
  assert.equal(env.APP_URL, "https://pizarro-production.up.railway.app");
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /APP_URL no está definida: se usa https:\/\/pizarro-production\.up\.railway\.app \(RAILWAY_PUBLIC_DOMAIN/);
  // Otra vez (o en un proceso hijo con este entorno): sin repetir el aviso y con su origen.
  assert.equal(applyAppUrlFallback(env, (m) => lines.push(m)), "railway");
  assert.equal(lines.length, 1);
  assert.deepEqual(resolveAppUrl({ ...env }), { url: "https://pizarro-production.up.railway.app", source: "railway" });
  // Con APP_URL definida no se toca nada.
  const own: Record<string, string | undefined> = { APP_URL: "https://pizarro.example.com", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" };
  assert.equal(applyAppUrlFallback(own, () => assert.fail("sin aviso")), "env");
  assert.equal(own.APP_URL, "https://pizarro.example.com");
});

test("APP_URL: el arranque, el enlace de /setup, los emails y los scripts usan la misma regla", () => {
  assert.match(readFileSync("src/instrumentation.ts", "utf8"), /applyAppUrlFallback\(process\.env/);
  assert.match(readFileSync("scripts/boot.ts", "utf8"), /applyAppUrlFallback\(process\.env/);
  assert.match(readFileSync("scripts/doctor.ts", "utf8"), /applyAppUrlFallback\(process\.env/);
  assert.match(readFileSync("scripts/reset-link.ts", "utf8"), /resolveAppUrl\(\)\.url/);
  assert.match(readFileSync("src/lib/setup.ts", "utf8"), /resolveAppUrl\(env\)\.url/);
  assert.match(readFileSync("src/lib/mail.ts", "utf8"), /resolveAppUrl\(\)\.url/);
  // El aviso de start.sh no sale si Railway da la dirección.
  assert.match(readFileSync("scripts/start.sh", "utf8"), /\[ -n "\$APP_URL" \] \|\| \[ -n "\$RAILWAY_PUBLIC_DOMAIN" \] \|\| echo/);
});
