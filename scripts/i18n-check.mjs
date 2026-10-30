#!/usr/bin/env node
// Comprueba que todos los textos de t("…") tienen traducción al inglés.
//   node scripts/i18n-check.mjs [ruta…]   (por defecto, todo src/)
// Sale con código 1 y lista los que faltan. Solo mira llamadas con un literal simple.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) {
    if (p.includes("generated") || p.endsWith("i18n")) return;
    for (const f of readdirSync(p)) walk(join(p, f));
  } else if (/\.(ts|tsx)$/.test(p)) files.push(p);
};
roots.forEach(walk);

// Diccionario: claves de src/i18n/en/*.ts (objetos planos "es": "en").
const dict = new Set();
for (const f of readdirSync("src/i18n/en")) {
  const text = readFileSync(join("src/i18n/en", f), "utf8");
  for (const m of text.matchAll(/^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:/gm)) dict.add(JSON.parse(m[1].startsWith("'") ? `"${m[1].slice(1, -1).replace(/"/g, '\\"')}"` : m[1]));
}

const missing = new Map();
const call = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)\s*[,)]/g;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(call)) {
    const raw = m[1];
    const key = raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1, -1).replace(/\\(.)/g, "$1");
    if (!dict.has(key)) missing.set(key, f);
  }
}

// Mensajes de servidor: new AppError("…"), message: "…" (zod, addIssue) y .min/.max/.length(n, "…") en src/lib y src/actions.
const lit = String.raw`("(?:[^"\\\n]|\\.)*")`;
const serverCalls = [
  new RegExp(String.raw`new AppError\(\s*` + lit, "g"),
  new RegExp(String.raw`\bmessage:\s*` + lit, "g"),
  new RegExp(String.raw`\.(?:min|max|length|gt|gte|lt|lte|regex)\([^()"\n]*,\s*` + lit, "g"),
];
for (const f of files.filter((f) => /^src[\\/](lib|actions)[\\/]/.test(f))) {
  const text = readFileSync(f, "utf8");
  for (const re of serverCalls) {
    for (const m of text.matchAll(re)) {
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      if (text.slice(lineStart, m.index).includes("logEvent(")) continue; // los mensajes del registro no se traducen
      const key = JSON.parse(m[1]);
      if (!dict.has(key)) missing.set(key, f);
    }
  }
}
if (missing.size) {
  for (const [k, f] of missing) console.log(`${f}: ${JSON.stringify(k)}`);
  console.log(`\nFaltan ${missing.size} traducciones.`);
  process.exit(1);
}
console.log("Todas las traducciones están.");
