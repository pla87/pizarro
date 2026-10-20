#!/usr/bin/env node
// Registra una nueva versión de la aplicación.
//
//   npm run version:bump -- patch|minor|major|X.Y.Z [--date YYYY-MM-DD] [--summary "texto"]
//   npm run version:bump -- --render      (solo regenera CHANGELOG.md)
//
// Actualiza package.json (y package-lock.json), añade la entrada en changelog.json
// y regenera CHANGELOG.md. La tabla AppVersionLog se sincroniza al arrancar la app
// (o con `npm run changelog:sync`).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CATEGORIES = [
  ["nuevas", "Nuevas funcionalidades"],
  ["mejoras", "Mejoras"],
  ["correcciones", "Correcciones"],
  ["tecnicos", "Cambios técnicos / DB"],
];

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const writeJson = (f, data) => writeFileSync(f, JSON.stringify(data, null, 2) + "\n");

function renderMarkdown(changelog) {
  const out = ["# Changelog", "", "Historial de versiones de Pizarro. Fuente: `changelog.json`.", ""];
  for (const v of changelog.versions) {
    const time = v.releasedAt ? ` ${v.releasedAt.slice(11, 16)}` : "";
    out.push(`## v${v.version} — ${v.date}${time}`, "");
    if (v.summary) out.push(v.summary, "");
    for (const [key, label] of CATEGORIES) {
      const items = v.changes?.[key] ?? [];
      if (!items.length) continue;
      out.push(`### ${label}`, "", ...items.map((i) => `- ${i}`), "");
    }
  }
  return out.join("\n");
}

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [ma, mi, pa] = current.split(".").map(Number);
  if (kind === "major") return `${ma + 1}.0.0`;
  if (kind === "minor") return `${ma}.${mi + 1}.0`;
  if (kind === "patch") return `${ma}.${mi}.${pa + 1}`;
  throw new Error(`Tipo de versión no válido: ${kind} (usa patch, minor, major o X.Y.Z)`);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const changelog = readJson("changelog.json");

if (!args.includes("--render")) {
  const kind = args.find((a) => !a.startsWith("--") && a !== opt("--date") && a !== opt("--summary"));
  if (!kind) {
    console.error("Uso: npm run version:bump -- patch|minor|major|X.Y.Z [--date YYYY-MM-DD] [--summary \"texto\"]");
    process.exit(1);
  }
  const pkg = readJson("package.json");
  const next = bump(pkg.version, kind);
  if (changelog.versions.some((v) => v.version === next)) {
    console.error(`La versión ${next} ya existe en changelog.json`);
    process.exit(1);
  }
  // Hora local del lanzamiento con su desfase (p. ej. 2026-10-20T19:10:00+02:00).
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offset * 60000).toISOString().slice(0, 19);
  const releasedAt = `${local}${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`;
  const date = opt("--date") ?? releasedAt.slice(0, 10);
  changelog.versions.unshift({
    version: next,
    date,
    releasedAt,
    summary: opt("--summary") ?? "",
    changes: { nuevas: [], mejoras: [], correcciones: [], tecnicos: [] },
  });
  pkg.version = next;
  writeJson("package.json", pkg);
  if (existsSync("package-lock.json")) {
    const lock = readJson("package-lock.json");
    lock.version = next;
    if (lock.packages?.[""]) lock.packages[""].version = next;
    writeJson("package-lock.json", lock);
  }
  writeJson("changelog.json", changelog);
  console.log(`Versión ${next} registrada. Rellena sus cambios en changelog.json y ejecuta "npm run version:bump -- --render".`);
}

writeFileSync("CHANGELOG.md", renderMarkdown(changelog));
console.log("CHANGELOG.md actualizado.");
