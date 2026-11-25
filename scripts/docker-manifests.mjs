// Etapa «manifests» del Dockerfile: package.json y package-lock.json con la versión de la app fija («0.0.0») y, en
// package.json, sin `scripts`, para instalar las dependencias con ellos.
//
//   node scripts/docker-manifests.mjs <carpeta con package.json y package-lock.json>   (los reescribe en su sitio)
//
// La versión cambia en cada publicación (está en los dos ficheros) y, copiados tal cual, invalidaban la caché de la capa
// de `npm ci` (y la del migrador) aunque las dependencias fueran las mismas: cada versión volvía a descargar e instalar
// todo. Con la versión fija, dos versiones con las mismas dependencias dan exactamente los mismos bytes y Docker reutiliza
// la instalación. Lo mismo con `scripts`: cambiar `test` o `build:boot` no cambia lo que instala `npm ci`, que solo
// ejecuta los de su ciclo de vida (INSTALL_SCRIPTS), y el proyecto no tiene ninguno; si un día se añade uno, este
// script falla para no quitarlo sin avisar. La versión y los scripts reales los lleva el package.json que la etapa de
// build copia con el código (`COPY . .`).
// Sin dependencias (corre en la imagen base antes de instalar nada). Pruebas: tests/docker-build.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FIXED_VERSION = "0.0.0";

/** Los scripts del paquete raíz que `npm ci` ejecuta (ciclo de vida de la instalación). */
export const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"];

/**
 * El texto de package.json o de package-lock.json con la versión de la app (la raíz) fija y, en package.json, sin
 * `scripts`; lo demás, igual. Falla si package.json tiene un script que `npm ci` ejecutaría.
 */
export function withFixedVersion(text, kind) {
  const json = JSON.parse(text);
  if ("version" in json) json.version = FIXED_VERSION;
  if (kind === "package" && "scripts" in json) {
    const used = INSTALL_SCRIPTS.filter((name) => json.scripts?.[name] !== undefined);
    if (used.length) throw new Error(`package.json tiene scripts que \`npm ci\` ejecuta (${used.join(", ")}): quitarlos de la etapa «manifests» los saltaría. Revisa scripts/docker-manifests.mjs.`);
    delete json.scripts;
  }
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
