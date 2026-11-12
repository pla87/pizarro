// `npm start`: arranca la salida standalone de Next (.next/standalone/server.js) fuera de Docker. Las variables ya
// vienen cargadas (--env-file del .env del proyecto y de scripts/server.env). Antes de cargar server.js, que cambia a
// su propia carpeta, se fijan como absolutas las rutas de datos relativas (scripts/local-paths.mjs): así las subidas y
// las copias quedan en la carpeta del proyecto y no dentro de .next/standalone. El contenedor no usa este script
// (scripts/start.sh ejecuta server.js con UPLOAD_DIR=/app/uploads).
//
// package.json lanza este script con `node …` (sin `exec`, que solo entienden los shells POSIX: en Windows npm usa
// cmd.exe). Al parar npm (SIGTERM), npm la reenvía a su `sh -c`, y dash muere sin pasarla a node; por eso este script
// vigila al proceso padre (scripts/parent-watch.mjs) y, en cuanto desaparece (o el sistema adopta al huérfano), lanza el
// apagado ordenado: como mucho ~1 s después. Cubre también npm muerto de golpe (SIGKILL, cierre de la terminal) y
// Windows. Solo cuando lo lanza npm: arrancado a mano en segundo plano, el padre es la terminal.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { absoluteDataPaths } from "./local-paths.mjs";
import { shutdownAsIfSigterm, watchParent } from "./parent-watch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Object.assign(process.env, absoluteDataPaths(process.env, root));

const server = path.join(root, ".next", "standalone", "server.js");
if (!existsSync(server)) {
  console.error("[start] No existe .next/standalone/server.js: compila antes con «npm run build».");
  process.exit(1);
}
await import(pathToFileURL(server).href);

if (process.env.npm_lifecycle_event) {
  watchParent({
    onOrphan: () => {
      console.info("[start] el proceso que lanzó el servidor (npm) ha terminado: apagado ordenado");
      shutdownAsIfSigterm();
    },
  });
}
