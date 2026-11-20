#!/usr/bin/env node
// Qué suites e2e tocan los cambios de esta rama. Lee el mapa e2e/suites.json (suite → patrones de ficheros) y los
// ficheros cambiados desde el punto en que la rama salió de la base (`git diff --name-only $(git merge-base BASE HEAD)`,
// con lo que aún no está en un commit y los ficheros nuevos sin seguimiento). Uso, desde la raíz del repositorio:
//
//   node scripts/e2e-affected.mjs              # base origin/main; imprime las suites separadas por espacios
//   node scripts/e2e-affected.mjs HEAD~2       # otra base
//   node scripts/e2e-affected.mjs --why        # además, por qué entra cada una (a stderr)
//
// Lo usa `AFFECTED=1 scripts/e2e-all.sh`. Reglas (las mismas que describe e2e/README.md):
//   - la QA («always») va siempre;
//   - un fichero de «all» (dependencias, arnés de las suites, arranque del servidor…) lanza todas;
//   - un fichero de una suite (e2e/<suite>.mjs) la lanza a ella;
//   - un fichero de «common.files» (globals.css, layouts, i18n, lib/action.ts…) lanza common.suites;
//   - cada suite, si un fichero coincide con uno de sus patrones;
//   - un fichero de src/, prisma/ o public/ que no coincide con nada cuenta como común (mejor de más que de menos).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Patrón → RegExp. `**` cualquier ruta (también vacía), `*` y `?` sin cruzar «/», `{a,b}` alternativas; el resto,
 *  literal (los `[projectId]` y `(app)` de Next no son clases ni grupos). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) throw new Error(`Patrón sin cerrar: ${glob}`);
      re += "(?:" + glob.slice(i + 1, end).split(",").map((p) => p.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
      i = end;
    } else re += c.replace(/[.+^$(){}|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Orden de ejecución: la QA, las suites como las lista e2e-all.sh (orden alfabético) y la instalación al final. */
function ordered(names, all) {
  return all.filter((s) => names.has(s));
}

/**
 * @param {string[]} files ficheros cambiados (rutas desde la raíz del repositorio)
 * @param {{ always: string[], all: string[], common: { suites: string[], files: string[] }, suites: Record<string, string[]> }} map
 * @returns {{ suites: string[], why: Map<string, string[]>, everything: string[] }} `everything`: los ficheros de «all»
 */
export function selectSuites(files, map) {
  const allSuites = [...map.always, ...Object.keys(map.suites).filter((s) => s !== "install-e2e").sort(), ...("install-e2e" in map.suites ? ["install-e2e"] : [])];
  const why = new Map();
  const everything = [];
  const add = (suite, reason) => { if (!why.has(suite)) why.set(suite, []); why.get(suite).push(reason); };
  for (const s of map.always) add(s, "siempre");
  const test = (globs) => { const res = globs.map(globToRegExp); return (f) => res.some((r) => r.test(f)); };
  const inAll = test(map.all);
  const inCommon = test(map.common.files);
  const bySuite = Object.entries(map.suites).map(([s, globs]) => [s, test(globs)]);
  for (const f of files) {
    if (inAll(f)) { everything.push(f); for (const s of allSuites) add(s, `${f} (afecta a todas)`); continue; }
    let hit = false;
    const own = /^e2e\/([\w-]+)\.mjs$/.exec(f);
    if (own && own[1] in map.suites) { add(own[1], f); hit = true; }
    if (inCommon(f)) { for (const s of map.common.suites) add(s, `${f} (común)`); hit = true; }
    for (const [s, match] of bySuite) if (match(f)) { add(s, f); hit = true; }
    if (!hit && /^(src|prisma|public)\//.test(f)) for (const s of map.common.suites) add(s, `${f} (sin mapa: común)`);
  }
  return { suites: ordered(new Set(why.keys()), allSuites), why, everything };
}

export function loadMap(path = "e2e/suites.json") {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Suites del mapa que no existen y ficheros de suite que no están en el mapa. */
export function mapProblems(map, dir = "e2e") {
  const files = readdirSync(dir).filter((f) => f.endsWith("-e2e.mjs")).map((f) => f.slice(0, -4));
  const missing = files.filter((f) => !(f in map.suites));
  const extra = Object.keys(map.suites).filter((s) => !files.includes(s));
  return { missing, extra };
}

function changedFiles(base) {
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
  const from = git("merge-base", base, "HEAD")[0];
  return [...new Set([...git("diff", "--name-only", from), ...git("ls-files", "--others", "--exclude-standard")])];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const explain = args.includes("--why");
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
  const map = loadMap();
  const { missing, extra } = mapProblems(map);
  if (missing.length || extra.length) {
    if (missing.length) console.error(`Suites sin entrada en e2e/suites.json: ${missing.join(", ")}`);
    if (extra.length) console.error(`Entradas de e2e/suites.json sin su fichero en e2e/: ${extra.join(", ")}`);
    process.exit(2);
  }
  let files;
  try {
    files = changedFiles(base);
  } catch {
    console.error(`No se pudo comparar con ${base} (¿existe? prueba con git fetch origin main).`);
    process.exit(2);
  }
  const { suites, why, everything } = selectSuites(files, map);
  if (explain) {
    console.error(`${files.length} ficheros cambiados respecto a ${base}; ${suites.length} suites:`);
    if (everything.length) console.error(`  todas, porque cambia: ${everything.join(", ")}`);
    else for (const s of suites) {
      const r = why.get(s);
      console.error(`  ${s}: ${r.slice(0, 3).join(", ")}${r.length > 3 ? ` y ${r.length - 3} más` : ""}`);
    }
  } else console.log(suites.join(" "));
}
