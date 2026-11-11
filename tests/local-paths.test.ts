// `npm start` (scripts/start-local.mjs): las rutas de datos relativas se resuelven contra la raíz del proyecto, no
// contra .next/standalone (server.js hace process.chdir(__dirname) y cada compilación borra esa carpeta).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

type Fn = (env: Record<string, string | undefined>, root: string) => Record<string, string>;
// Especificador no literal: el script es .mjs (lo ejecuta node sin compilar) y tsc no tiene sus tipos.
const { absoluteDataPaths } = (await import(new URL("../scripts/local-paths.mjs", import.meta.url).href)) as { absoluteDataPaths: Fn };

const root = path.resolve("/srv/pizarro");

test("UPLOAD_DIR relativa (la de .env.example) o sin definir: dentro del proyecto, nunca en .next/standalone", () => {
  assert.deepEqual(absoluteDataPaths({ UPLOAD_DIR: "./uploads" }, root), { UPLOAD_DIR: path.join(root, "uploads") });
  assert.deepEqual(absoluteDataPaths({ UPLOAD_DIR: "datos/subidas " }, root), { UPLOAD_DIR: path.join(root, "datos", "subidas") });
  assert.deepEqual(absoluteDataPaths({}, root), { UPLOAD_DIR: path.join(root, "uploads") });
});

test("las rutas absolutas (Docker, Railway) y las vacías no se tocan", () => {
  assert.deepEqual(absoluteDataPaths({ UPLOAD_DIR: "/app/uploads", BACKUP_EXTERNAL_DIR: "/mnt/usb", MAIL_OUTBOX_DIR: "" }, root), {});
});

test("también el buzón de pruebas y el destino externo de las copias, si son relativos", () => {
  assert.deepEqual(absoluteDataPaths({ UPLOAD_DIR: "/app/uploads", MAIL_OUTBOX_DIR: "outbox", BACKUP_EXTERNAL_DIR: "../copias" }, root), {
    MAIL_OUTBOX_DIR: path.join(root, "outbox"),
    BACKUP_EXTERNAL_DIR: path.resolve(root, "..", "copias"),
  });
});

test("npm start pasa por el lanzador, y el contenedor sigue arrancando server.js con /app/uploads", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.start!, /scripts\/start-local\.mjs$/);
  assert.match(readFileSync("Dockerfile", "utf8"), /UPLOAD_DIR=\/app\/uploads/);
  assert.match(readFileSync("scripts/start.sh", "utf8"), /exec node server\.js/);
});
