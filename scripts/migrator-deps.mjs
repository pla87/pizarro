// Dependencias del migrador de la imagen Docker (etapa «migrator» del Dockerfile): solo el CLI de Prisma, para
// `prisma migrate deploy` en cada arranque (scripts/start.sh).
//
//   node scripts/migrator-deps.mjs <dir con package.json y package-lock.json> <dir del migrador>
//     Escribe en el migrador un package.json con `prisma` (la versión exacta del proyecto) y un package-lock.json con
//     solo lo que el CLI necesita, sacado del lockfile del proyecto: `npm ci` instala exactamente esas versiones y
//     comprueba sus hashes. Antes se instalaba sin lockfile (`npm install prisma@…`), con dependencias sin fijar.
//   node scripts/migrator-deps.mjs --prune <dir del migrador>
//     Quita, ya instalados, los ficheros y paquetes que `migrate deploy` no usa (ver UNUSED).
//
// Sin dependencias (corre en la imagen base antes de instalar nada). Pruebas: tests/migrator-deps.test.ts.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lo que `prisma migrate deploy` no lee (rutas dentro de node_modules; «*» al final = todo lo que empiece así). Medido
 * con un gancho de módulos de Node y `strace` (ficheros abiertos) en `--version`, `migrate deploy` (con migraciones
 * pendientes, sin ellas, con una que falla y sin servidor), `migrate status` y `migrate diff`: el CLI solo carga
 * prisma/build/{index,cli,child}.js, prisma_schema_build_bg.wasm, el binario de @prisma/engines y unos pocos paquetes
 * pequeños (effect, remeda, c12, jiti…). Lo de aquí es de otras órdenes: Prisma Studio (`prisma studio`: su interfaz,
 * React, gráficos), `prisma dev` (PostgreSQL embebido con PGlite), los compiladores de consultas de `prisma generate`
 * (el cliente se genera al compilar la app, no aquí) y los clientes de MySQL y PostgreSQL de Studio. El CLI los carga
 * con import() solo al usar esas órdenes. Al subir de versión Prisma, el Dockerfile comprueba después de podar que
 * `prisma --version` y `prisma migrate diff` siguen funcionando (si no, falla la construcción, no el arranque).
 */
export const UNUSED = [
  "@prisma/studio-core/dist/ui", "@prisma/studio-core/dist/metafile-*", "prisma/build/studio.*",
  "@prisma/dev/dist/runtime-assets", "@electric-sql", "@prisma/streams-local", "@prisma/query-plan-executor",
  "prisma/build/query_compiler_*",
  "react", "react-dom", "scheduler", "@types", "csstype", "@visx", "elkjs", "lodash", "mysql2", "postgres",
];

/** Ruta en el lockfile del paquete `name` tal como lo resuelve Node desde `from` (anidado primero, luego hacia arriba). */
function resolveIn(packages, from, name) {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!dir) return null;
    const i = dir.lastIndexOf("/node_modules/");
    dir = i === -1 ? "" : dir.slice(0, i);
  }
}

/**
 * package.json y package-lock.json del migrador a partir del lockfile del proyecto: `prisma` y todo lo que necesita
 * (dependencias, opcionales y «peer» no opcionales; sin las «peer» opcionales como typescript), con sus versiones y hashes.
 */
export function migratorManifest(appPackage, appLock) {
  const version = appPackage.devDependencies?.prisma ?? appPackage.dependencies?.prisma;
  if (!version) throw new Error("package.json no declara prisma");
  if (appLock.lockfileVersion < 2 || !appLock.packages) throw new Error("package-lock.json sin «packages» (lockfileVersion >= 2)");
  const packages = appLock.packages;
  const root = "node_modules/prisma";
  if (packages[root]?.version !== version) throw new Error(`package-lock.json tiene prisma ${packages[root]?.version ?? "(ninguno)"} y package.json ${version}`);
  const picked = new Set();
  const queue = [root];
  while (queue.length) {
    const key = queue.shift();
    if (picked.has(key)) continue;
    picked.add(key);
    const entry = packages[key];
    // npm instala también las «peer» no opcionales (y `npm ci` exige que estén en el lockfile).
    const peers = Object.fromEntries(Object.keys(entry.peerDependencies ?? {}).filter((n) => !entry.peerDependenciesMeta?.[n]?.optional).map((n) => [n, ""]));
    for (const [deps, optional] of [[entry.dependencies, false], [entry.optionalDependencies, true], [peers, false]]) {
      for (const name of Object.keys(deps ?? {})) {
        const found = resolveIn(packages, key, name);
        if (found) queue.push(found);
        else if (!optional) throw new Error(`${key} necesita ${name} y no está en package-lock.json`);
      }
    }
  }
  const pkg = { name: "pizarro-migrator", private: true, type: "module", dependencies: { prisma: version } };
  const lockPackages = { "": { name: pkg.name, dependencies: pkg.dependencies } };
  for (const key of [...picked].sort()) {
    // Las marcas de desarrollo del proyecto (prisma es devDependency allí) no valen aquí: es una dependencia normal.
    const { dev: _dev, devOptional: _devOptional, peer: _peer, ...entry } = packages[key];
    lockPackages[key] = entry;
  }
  return { pkg, lock: { name: pkg.name, lockfileVersion: 3, requires: true, packages: lockPackages } };
}

/** Borra de `dir/node_modules` lo de UNUSED que haya. Devuelve lo que ha quitado. */
export function prune(dir) {
  const removed = [];
  const nm = path.join(dir, "node_modules");
  for (const entry of UNUSED) {
    const targets = entry.endsWith("*")
      ? (() => {
          const parent = path.join(nm, path.dirname(entry));
          const prefix = path.basename(entry).slice(0, -1);
          return existsSync(parent) ? readdirSync(parent).filter((f) => f.startsWith(prefix)).map((f) => path.join(parent, f)) : [];
        })()
      : [path.join(nm, entry)].filter((p) => existsSync(p));
    for (const target of targets) {
      rmSync(target, { recursive: true, force: true });
      removed.push(path.relative(nm, target));
    }
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (a === "--prune" && b) {
    console.log(`[migrator] quitados: ${prune(b).join(", ") || "(nada)"}`);
  } else if (a && b) {
    const read = (f) => JSON.parse(readFileSync(path.join(a, f), "utf8"));
    const { pkg, lock } = migratorManifest(read("package.json"), read("package-lock.json"));
    writeFileSync(path.join(b, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(path.join(b, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`[migrator] prisma ${pkg.dependencies.prisma}: ${Object.keys(lock.packages).length - 1} paquetes del lockfile`);
  } else {
    console.error("Uso: node scripts/migrator-deps.mjs <dir del proyecto> <dir del migrador> | --prune <dir del migrador>");
    process.exit(2);
  }
}
