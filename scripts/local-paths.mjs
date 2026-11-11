// Rutas de datos para `npm start` (scripts/start-local.mjs). El server.js de la salida standalone de Next hace
// process.chdir(__dirname): sin esto, una ruta relativa como UPLOAD_DIR="./uploads" (la de .env.example) se resolvería
// dentro de .next/standalone, que borra cada compilación. Aquí se resuelven contra la raíz del proyecto (la carpeta de
// package.json, desde la que también se ejecutan dist/boot.mjs y dist/restore.mjs), antes de que el servidor cambie de carpeta.
import path from "node:path";

/** Variables con rutas de datos que la app resuelve con path.resolve (relativas a la carpeta actual). */
export const DATA_PATH_VARS = ["UPLOAD_DIR", "MAIL_OUTBOX_DIR", "BACKUP_EXTERNAL_DIR"];

/**
 * Devuelve las variables que hay que fijar: las rutas relativas, absolutas contra `root`, y UPLOAD_DIR sin definir,
 * `root`/uploads (el mismo valor por defecto que src/lib/upload-dir.ts, pero en la raíz). Las absolutas (Docker,
 * Railway: /app/uploads) y las vacías no se tocan.
 */
export function absoluteDataPaths(env, root) {
  const out = {};
  for (const name of DATA_PATH_VARS) {
    const raw = env[name];
    if (raw === undefined) {
      if (name === "UPLOAD_DIR") out[name] = path.resolve(root, "uploads");
      continue;
    }
    const v = raw.trim();
    if (!v || path.isAbsolute(v)) continue;
    out[name] = path.resolve(root, v);
  }
  return out;
}
