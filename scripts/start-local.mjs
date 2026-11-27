// `npm start`: arranca la salida standalone de Next (.next/standalone/server.js) fuera de Docker. Las variables ya
// vienen cargadas (--env-file del .env del proyecto y de scripts/server.env). Antes de cargar server.js, que cambia a
// su propia carpeta, se fijan como absolutas las rutas de datos relativas (scripts/local-paths.mjs): así las subidas y
// las copias quedan en la carpeta del proyecto y no dentro de .next/standalone. El contenedor no usa este script
// (scripts/start.sh ejecuta server.js con UPLOAD_DIR=/app/uploads).
//
// Antes ejecuta las mismas tareas de arranque que el contenedor (dist/boot.mjs, sin abrir otro servidor): registro del
// arranque, historial de versiones, seed, código del asistente /setup (sale en esta terminal) y plantillas de serie. Sin
// ellas, una instalación nueva con `npm start` no podía terminar el asistente. Van en un proceso hijo aparte
// (`node dist/boot.mjs`, con el mismo entorno): lo que carga boot (Prisma, migraciones, plantillas…, unos 170 MB) se
// libera al terminar, en vez de quedarse en el proceso del servidor. Si el hijo no termina con código 0, no se arranca.
//
// package.json lanza este script con `node …` (sin `exec`, que solo entienden los shells POSIX: en Windows npm usa
// cmd.exe). Al parar npm (SIGTERM), npm la reenvía a su `sh -c`, y dash muere sin pasarla a node; por eso este script
// vigila al proceso padre (scripts/parent-watch.mjs) y, en cuanto desaparece (o el sistema adopta al huérfano), lanza el
// apagado ordenado: como mucho ~1 s después. Cubre también npm muerto de golpe (SIGKILL, cierre de la terminal) y
// Windows. Solo cuando lo lanza npm: arrancado a mano en segundo plano, el padre es la terminal.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { absoluteDataPaths } from "./local-paths.mjs";
import { pendingMigrationsReason } from "./migrate.mjs";
import { shutdownAsIfSigterm, watchParent } from "./parent-watch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Object.assign(process.env, absoluteDataPaths(process.env, root));

const server = path.join(root, ".next", "standalone", "server.js");
const boot = path.join(root, "dist", "boot.mjs");
for (const [file, label] of [[server, ".next/standalone/server.js"], [boot, "dist/boot.mjs"]]) {
  if (!existsSync(file)) {
    console.error(`[start] No existe ${label}: compila antes con «npm run build».`);
    process.exit(1);
  }
}
// server.js lo fija igualmente al cargarse; antes, para que las tareas de arranque se comporten como en producción.
process.env.NODE_ENV = "production";
// La página /setup dice dónde mirar el código según cómo se arrancó (aquí: esta terminal).
process.env.PIZARRO_LAUNCHER = "npm";

/**
 * Lanza dist/boot.mjs en un proceso hijo (el mismo node, sin shell: también en Windows) y espera a que termine. Si este
 * proceso recibe SIGTERM (o el apagado de parent-watch) mientras corre, mata al hijo y sale. Devuelve cómo terminó.
 */
function runBootChild() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [boot], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    const onTerm = () => {
      child.kill("SIGTERM");
      process.exit(143);
    };
    process.on("SIGTERM", onTerm);
    const done = (result) => {
      // Fuera el manejador: server.js instala los suyos.
      process.off("SIGTERM", onTerm);
      resolve(result);
    };
    child.once("error", (error) => done({ error }));
    child.once("exit", (code, signal) => done({ code, signal }));
  });
}

if (process.env.npm_lifecycle_event) {
  // Desde antes de las tareas de arranque: si npm desaparece mientras corren, se mata al hijo (arriba) y no queda huérfano.
  watchParent({
    onOrphan: () => {
      console.info("[start] el proceso que lanzó el servidor (npm) ha terminado: apagado ordenado");
      shutdownAsIfSigterm();
    },
  });
}

// Sin migrar (se olvidó `npx prisma migrate deploy` tras actualizar), el servidor arrancaba con el esquema viejo y las
// páginas que leen columnas nuevas daban 500. Se para con un aviso claro (el contenedor migra solo: scripts/start.sh).
const pending = await pendingMigrationsReason(fileURLToPath(new URL("..", import.meta.url)), process.env.DATABASE_URL ?? "").catch(() => null);
if (pending) {
  console.error(`[start] La base de datos no está al día con las migraciones (${pending}).`);
  console.error("[start] Aplícalas antes de arrancar: npx prisma migrate deploy");
  process.exit(1);
}

const booted = await runBootChild();
if (booted.error || booted.code !== 0) {
  console.error("[start] Fallaron las tareas de arranque:", booted.error ?? (booted.signal ? `el proceso terminó por ${booted.signal}` : `el proceso terminó con código ${booted.code}`));
  console.error("[start] Comprueba DATABASE_URL y que las migraciones están aplicadas (npx prisma migrate deploy).");
  process.exit(1);
}
await import(pathToFileURL(server).href);

