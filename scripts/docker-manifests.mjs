// Etapa «manifests» del Dockerfile: package.json y package-lock.json con la versión de la app fija («0.0.0»), para
// instalar las dependencias con ellos.
//
//   node scripts/docker-manifests.mjs <carpeta con package.json y package-lock.json>   (los reescribe en su sitio)
//
// La versión cambia en cada publicación (está en los dos ficheros) y, copiados tal cual, invalidaban la caché de la capa
// de `npm ci` (y la del migrador) aunque las dependencias fueran las mismas: cada versión volvía a descargar e instalar
// todo. Con la versión fija, dos versiones con las mismas dependencias dan exactamente los mismos bytes y Docker reutiliza
// la instalación. La versión real la lleva el package.json que la etapa de build copia con el código (`COPY . .`).
// Sin dependencias (corre en la imagen base antes de instalar nada). Pruebas: tests/docker-build.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FIXED_VERSION = "0.0.0";

/** El texto de package.json o de package-lock.json con la versión de la app (la raíz) fija; lo demás, igual. */
export function withFixedVersion(text, kind) {
  const json = JSON.parse(text);
  if ("version" in json) json.version = FIXED_VERSION;
  if (kind === "lock" && json.packages?.[""] && "version" in json.packages[""]) json.packages[""].version = FIXED_VERSION;
  return `${JSON.stringify(json, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Uso: node scripts/docker-manifests.mjs <carpeta con package.json y package-lock.json>");
    process.exit(1);
  }
  for (const [file, kind] of [["package.json", "package"], ["package-lock.json", "lock"]]) {
    const at = path.join(dir, file);
    writeFileSync(at, withFixedVersion(readFileSync(at, "utf8"), kind));
  }
}
