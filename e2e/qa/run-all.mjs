#!/usr/bin/env node
// Suite de regresión de las acciones del tablero de Pizarro (moveTask, updateTask, deployRelease y derivadas).
//
// Uso:
//   BASE=http://localhost:3231 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pz_qa \
//   APP_DIR=/ruta/al/worktree node run-all.mjs [--no-reset] [--only=1,4,7] [--json=salida.json]
//
// Reinicio (por defecto):
//   - con APP_DIR: borra y crea la base (solo nombres pz_*), `prisma migrate deploy`, `dist/boot.mjs` y arranca
//     `npm start` en el puerto de BASE (debe estar libre; compila antes con next build + postbuild + build:boot);
//   - sin APP_DIR no se puede reiniciar: usa --no-reset.
// --no-reset (o SKIP_RESET=1): usa la base y el servidor tal cual; solo prepara usuarios (MEMBER, qa2@example.com,
//   ProjectMember) y cada escenario vacía las tareas del proyecto de ejemplo al empezar.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import * as L from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.some((a) => a === `--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const skipReset = flag("no-reset") || process.env.SKIP_RESET === "1";
const only = (opt("only") || process.env.ONLY || "").split(",").filter(Boolean).map(Number);
const appDir = process.env.APP_DIR;

const SCENARIOS = [
  [1, "./s1-drag.mjs"], [2, "./s2-move.mjs"], [3, "./s3-recurring.mjs"], [4, "./s4-edit.mjs"], [5, "./s5-conflict.mjs"],
  [6, "./s6-archive-dup-delete.mjs"], [7, "./s7-release.mjs"], [8, "./s8-live.mjs"], [9, "./s9-mobile.mjs"],
];

const t0 = Date.now();
console.log(`Pizarro QA · BASE=${L.BASE} · BD=${new URL(L.DATABASE_URL).pathname.slice(1)} · reset=${!skipReset}`);
try {
  if (!skipReset) {
    if (!appDir) throw new Error("Para reiniciar la base hace falta APP_DIR (carpeta de la app compilada), o usa --no-reset");
    try { const r = await fetch(L.BASE + "/login"); if (r.ok) throw new Error(`Ya hay un servidor respondiendo en ${L.BASE}: páralo (la suite arranca el suyo tras reiniciar la base) o usa --no-reset`); } catch (e) { if (/Ya hay/.test(e.message)) throw e; }
    console.log("Reiniciando base de datos…");
    await L.resetDatabase(appDir);
    console.log("Arrancando servidor…");
    await L.startServer(appDir);
  }
  await L.prepareUsers();
} catch (e) {
  console.error("FAIL  preparación:", e.message);
  L.stopServer();
  process.exit(2);
}

const timings = [];
for (const [n, file] of SCENARIOS) {
  if (only.length && !only.includes(n)) continue;
  const start = Date.now();
  try {
    const mod = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), file));
    await mod.run();
  } catch (e) {
    L.check(`escenario ${n}: terminó sin excepción`, false, e.stack || String(e));
  }
  timings.push([n, (Date.now() - start) / 1000]);
  // Un navegador por escenario: evita arrastrar estado entre ellos.
  await L.closeBrowser();
}

await L.closeDb();
L.stopServer();
const failed = L.results.filter((r) => !r.pass);
const notes = L.results.filter((r) => r.note);
console.log("\n==== Resumen ====");
for (const [n, s] of timings) {
  const rs = L.results.filter((r) => r.scenario.startsWith(`${n}.`));
  console.log(`  Escenario ${n}: ${rs.filter((r) => r.pass).length}/${rs.length} OK · ${s.toFixed(1)} s`);
}
if (notes.length) { console.log("Notas (comportamiento actual a vigilar, no fallan):"); for (const n of notes) console.log(`  - ${n.name}: ${n.detail}`); }
if (failed.length) { console.log("\nFALLOS:"); for (const f of failed) console.log(`  [${f.scenario}] ${f.name}${f.detail ? ` -> ${f.detail}` : ""}`); }
console.log(`\n${L.results.length - failed.length}/${L.results.length} comprobaciones OK · ${((Date.now() - t0) / 1000).toFixed(0)} s en total`);
const json = opt("json") || process.env.JSON_OUT;
if (json) fs.writeFileSync(json, JSON.stringify({ results: L.results, timings }, null, 1));
process.exit(failed.length ? 1 : 0);
