#!/usr/bin/env node
// Crea la etiqueta anotada vX.Y.Z (X.Y.Z = versión de package.json) en el commit actual.
//
//   npm run release:tag
//
// Se niega si el árbol de trabajo tiene cambios o si la etiqueta ya existe. No sube nada: al final
// imprime el comando para hacerlo (el push de la etiqueta lanza .github/workflows/release.yml).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`La versión «${version}» de package.json no es X.Y.Z.`);
const tag = `v${version}`;

try {
  git("rev-parse", "--git-dir");
} catch {
  fail("Esto no es un repositorio git.");
}
if (git("status", "--porcelain", "--untracked-files=no")) fail("Hay cambios sin confirmar: haz commit (o descártalos) antes de etiquetar.");
if (git("tag", "--list", tag)) fail(`La etiqueta ${tag} ya existe.`);

git("tag", "-a", tag, "-m", `Pizarro ${tag}`);
console.log(`Etiqueta ${tag} creada en ${git("rev-parse", "--short", "HEAD")}.`);
console.log(`Para publicarla (crea la release y la imagen Docker):\n  git push origin ${tag}`);
