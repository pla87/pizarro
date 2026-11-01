#!/usr/bin/env node
// Imprime las notas de una versión (Markdown) a partir de changelog.json: resumen en español + cambios por categoría.
//
//   node scripts/release-notes.mjs 1.38.0        (también vale v1.38.0)
//
// Lo usa .github/workflows/release.yml para el texto de la GitHub Release. Sale con error si la versión no está.
import { readFileSync } from "node:fs";

const CATEGORIES = [
  ["nuevas", "Nuevas funcionalidades"],
  ["mejoras", "Mejoras"],
  ["correcciones", "Correcciones"],
  ["tecnicos", "Cambios técnicos / DB"],
];

export function releaseNotes(changelog, version) {
  const v = changelog.versions.find((x) => x.version === version);
  if (!v) return null;
  const out = [];
  if (v.summary) out.push(v.summary, "");
  for (const [key, label] of CATEGORIES) {
    const items = v.changes?.[key] ?? [];
    if (items.length) out.push(`### ${label}`, "", ...items.map((i) => `- ${i}`), "");
  }
  out.push(`Cómo actualizar: https://github.com/pla87/pizarro/blob/main/docs/INSTALL.md#5-actualizar`, "");
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("Uso: node scripts/release-notes.mjs X.Y.Z");
    process.exit(2);
  }
  const notes = releaseNotes(JSON.parse(readFileSync("changelog.json", "utf8")), version);
  if (notes === null) {
    console.error(`La versión ${version} no está en changelog.json`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
