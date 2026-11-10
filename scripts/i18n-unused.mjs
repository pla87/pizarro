#!/usr/bin/env node
// Informa de las traducciones de src/i18n/en/*.ts que parecen sin uso. Solo informa: no borra nada y sale con 0.
//   npm run i18n:unused            (o node scripts/i18n-unused.mjs [--all])
//
// Una clave (el texto en español) cuenta como usada si aparece como literal de texto en el código: src/ (salvo
// src/i18n/en), scripts/ y prisma/ (seed.ts y los INSERT/UPDATE de las migraciones, que guardan textos en la base).
// No hace falta que esté dentro de t("…"): muchas pasan por constantes (PRIORITY_LABEL, pestañas, etiquetas de
// deshacer e historial {k: "…"}) y se traducen con t(variable). Las plantillas `…${x}…` del código se comparan como
// comodines y avisan de las claves que podrían construir (p. ej. `Máximo ${MAX} columnas.`).
//
// Antes de borrar una clave que sale aquí, comprueba que no puede venir de datos guardados que se traducen al
// pintarlos: el historial de cada tarea (TaskEvent, un año) y el deshacer (7 días) guardan {k: plantilla} y la
// traducen al leerla; los errores de exportar/importar (ProjectTransferJob.error) también. `git log -S'"texto"'`
// dice cuándo dejó de generarse. Las que se conservan por eso van agrupadas bajo un comentario que contiene
// «textos guardados por versiones anteriores» (el comentario de línea más cercano por encima) y aquí se listan aparte.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const all = process.argv.includes("--all");
const DICT_DIR = join(root, "src/i18n/en");
const LEGACY = /textos guardados por versiones anteriores/i;

/** Ficheros de código bajo `dir` (sin node_modules, generated ni el propio diccionario). */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "generated" || p === DICT_DIR) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js|sql)$/.test(name)) out.push(p);
  }
  return out;
}

/** Literales de un fichero: textos exactos y patrones (plantillas con ${…}). */
function literals(file) {
  const text = readFileSync(file, "utf8");
  const exact = new Set();
  const patterns = [];
  if (file.endsWith(".sql")) {
    for (const m of text.matchAll(/'((?:[^']|'')*)'/g)) exact.add(m[1].replace(/''/g, "'"));
    return { exact, patterns };
  }
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) exact.add(node.text);
    else if (ts.isJsxText(node)) exact.add(node.text.trim());
    else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      // Solo plantillas con bastante texto fijo: `${a}${b}` casaría con todo.
      if (parts.join("").trim().length >= 4) patterns.push({ re: new RegExp(`^${parts.map(esc).join("[^]+")}$`), src: node.getText(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { exact, patterns };
}

function scan(dirs) {
  const exact = new Set();
  const patterns = [];
  for (const d of dirs) for (const f of walk(join(root, d))) {
    const l = literals(f);
    l.exact.forEach((s) => exact.add(s));
    for (const p of l.patterns) patterns.push({ ...p, file: relative(root, f) });
  }
  return { exact, patterns };
}

// Diccionario: claves por fichero (en el orden de index.ts, que es el que manda si una clave se repite), con su línea,
// su traducción y si están en un grupo de textos guardados por versiones anteriores.
const order = [...readFileSync(join(DICT_DIR, "index.ts"), "utf8").matchAll(/\.\.\.(\w+)\b/g)].map((m) => `${m[1]}.ts`);
const rank = (f) => (order.includes(f) ? order.indexOf(f) : order.length);
const files = readdirSync(DICT_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts").sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const keys = [];
const seen = new Map();
const duplicated = [];
for (const name of files) {
  const text = readFileSync(join(DICT_DIR, name), "utf8");
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name)) && ts.isStringLiteralLike(node.initializer)) {
      const start = node.getStart(sf);
      // El comentario de línea más cercano por encima decide el grupo.
      const above = text.slice(0, start).split("\n").reverse().find((l) => /^\s*\/\//.test(l)) ?? "";
      const k = { key: node.name.text, value: node.initializer.text, where: `src/i18n/en/${name}:${sf.getLineAndCharacterOfPosition(start).line + 1}`, legacy: LEGACY.test(above) };
      if (seen.has(k.key)) duplicated.push({ ...k, first: seen.get(k.key) });
      else seen.set(k.key, k);
      keys.push(k);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const code = scan(["src", "scripts", "prisma"]);
const tests = scan(["tests", "e2e"]);

const unused = [];
const dynamic = [];
const onlyTests = [];
const legacyKept = [];
for (const k of keys) {
  if (code.exact.has(k.key)) continue;
  if (k.legacy) { legacyKept.push(k); continue; }
  const hits = code.patterns.filter((p) => p.re.test(k.key));
  if (hits.length) dynamic.push({ ...k, hits });
  else if (tests.exact.has(k.key)) onlyTests.push(k);
  else unused.push(k);
}

const show = (title, list, extra) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const k of list) console.log(`  ${k.where}  ${JSON.stringify(k.key)}${extra ? extra(k) : ""}`);
};
show("Sin uso: no aparecen como literal en el código", unused);
show("Solo aparecen en tests/ o e2e/", onlyTests);
if (all) show("Podrían salir de una plantilla del código", dynamic, (k) => `\n      ← ${k.hits.slice(0, 2).map((h) => `${h.file}: ${h.src.slice(0, 90)}`).join("\n      ← ")}`);
if (all) show("Conservadas como textos guardados por versiones anteriores", legacyKept);
show("Claves repetidas en varios ficheros (en la app gana la del último en index.ts)", duplicated, (k) =>
  `\n      también en ${k.first.where}${k.first.value === k.value ? " (mismo texto)" : `: ${JSON.stringify(k.first.value)} → ${JSON.stringify(k.value)}`}`);
console.log(`\n${keys.length} claves: ${unused.length} sin uso, ${onlyTests.length} solo en pruebas, ${duplicated.length} repetidas, ${dynamic.length} posibles por plantilla y ${legacyKept.length} conservadas por datos antiguos${all ? "" : " (--all para ver estas dos listas)"}.`);
