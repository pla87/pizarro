// Instalación en la nube sin servidor propio: el Blueprint de Render (render.yaml), el ejemplo de Fly.io (deploy/fly.toml)
// y Railway, que ya no lee railway.json (se configura en su panel; docs/INSTALL.md). Comprueba que los ficheros dicen lo
// mismo que la imagen: la carpeta de adjuntos del Dockerfile, /api/health, una sola instancia y las claves que pide
// scripts/start.sh y genera el botón de la guía web. Sin dependencias para leer YAML o TOML: basta con buscar las líneas.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { RAILWAY_KEY_BYTES } from "../src/lib/site-content";

const dockerfile = readFileSync("Dockerfile", "utf8");
const uploadDir = /UPLOAD_DIR=(\S+)/.exec(dockerfile)![1]!;
const port = /PORT=(\d+)/.exec(dockerfile)![1]!;
/** Quita los comentarios (las líneas que empiezan por «#») para no dar por buena una línea comentada. */
const code = (file: string) => readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("railway.json ya no está: Railway retiró «Config as Code» y el arranque lo da el CMD del Dockerfile", () => {
  assert.equal(existsSync("railway.json"), false);
  assert.equal(existsSync("railway.toml"), false);
  assert.match(dockerfile, /^CMD \["sh", "scripts\/start\.sh"\]$/m);
});

test("render.yaml: imagen oficial, disco en UPLOAD_DIR, /api/health, una instancia, PostgreSQL 16 y claves generadas", () => {
  const y = code("render.yaml");
  const [services, databases] = y.split(/^databases:$/m);
  assert.ok(services && databases, "render.yaml con services y databases");
  assert.equal(services.match(/^ {2}- type: /gm)?.length, 1, "un solo servicio");
  assert.match(services, /^ {4}type: web$|^ {2}- type: web$/m);
  assert.match(services, /^ {4}runtime: image$/m);
  assert.match(services, /^ {6}url: ghcr\.io\/pla87\/pizarro:\S+$/m);
  assert.match(services, /^ {4}numInstances: 1$/m);
  assert.match(services, /^ {4}healthCheckPath: \/api\/health$/m);
  assert.match(services, new RegExp(`^ {4}disk:\\n(?: {6}.*\\n)*? {6}mountPath: ${uploadDir}$`, "m"));
  assert.match(services, new RegExp(`- key: UPLOAD_DIR\\n {8}value: ${uploadDir}$`, "m"));
  // Los planes gratis no sirven: el servicio gratis no admite disco y la base gratis caduca a los 30 días.
  assert.doesNotMatch(y, /^\s*plan: free$/m);
  const region = (s: string) => /^ {4}region: (\S+)$/m.exec(s)?.[1];
  assert.ok(region(services));
  assert.equal(region(services), region(databases), "la app y la base en la misma región");
  assert.match(databases, /^ {4}postgresMajorVersion: "16"$/m);
  const db = /^ {2}- name: (\S+)$/m.exec(databases)?.[1];
  assert.match(services, new RegExp(`- key: DATABASE_URL\\n {8}fromDatabase:\\n {10}name: ${db}\\n {10}property: connectionString$`, "m"));
  for (const k of Object.keys(RAILWAY_KEY_BYTES)) assert.match(services, new RegExp(`- key: ${k}\\n {8}generateValue: true$`, "m"), k);
  // Starter tiene 512 MB: techo del generador de PDF y sin --max-old-space-size (anularía el resourceLimits del worker de
  // PDF; Node ajusta su montón al límite del contenedor). La imagen tampoco fija NODE_OPTIONS.
  assert.match(services, /^ {4}plan: starter$/m);
  assert.doesNotMatch(dockerfile, /NODE_OPTIONS/);
  assert.doesNotMatch(readFileSync("scripts/start.sh", "utf8"), /NODE_OPTIONS/);
  const pdf = Number(/- key: PDF_WORKER_MAX_MB\n {8}value: "(\d+)"$/m.exec(services)?.[1]);
  assert.ok(pdf >= 64 && pdf <= 4096, "PDF_WORKER_MAX_MB dentro de lo que admite report-render.ts");
  assert.ok(pdf <= 512 / 4, `PDF ${pdf} MB con margen dentro de 512 MB`);
  assert.doesNotMatch(services, /max-old-space-size/);
  // Sin APP_URL (se usa RENDER_EXTERNAL_URL) ni administrador por variables (lo crea /setup).
  assert.doesNotMatch(services, /- key: (APP_URL|SEED_ADMIN_\w+)$/m);
});

test("deploy/fly.toml: imagen oficial, volumen en UPLOAD_DIR, /api/health y una máquina siempre encendida", () => {
  const toml = code("deploy/fly.toml");
  const value = (re: RegExp) => re.exec(toml)?.[1];
  assert.match(value(/^\s*image\s*=\s*"([^"]+)"/m) ?? "", /^ghcr\.io\/pla87\/pizarro:/);
  assert.equal(value(/^\[mounts\][^[]*?destination\s*=\s*"([^"]+)"/m), uploadDir);
  assert.equal(value(/^\s*UPLOAD_DIR\s*=\s*"([^"]+)"/m), uploadDir);
  assert.equal(value(/^\s*internal_port\s*=\s*(\d+)/m), port);
  assert.equal(value(/^\s*auto_stop_machines\s*=\s*"([^"]+)"/m), "off");
  assert.equal(value(/^\s*min_machines_running\s*=\s*(\d+)/m), "1");
  assert.match(toml, /^\s*\[\[http_service\.checks\]\][^[]*path\s*=\s*"\/api\/health"/m);
});
