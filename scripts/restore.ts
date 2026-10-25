// Restaura una copia de seguridad de Pizarro (base de datos y, con --files, los ficheros) sin git ni Prisma CLI:
// la imagen ya lleva todas las migraciones. Compilado en dist/restore.mjs (npm run build:boot).
//
//   node dist/restore.mjs <origen> [--files | --files-only] [--force] [--list] [--migrations <carpeta>]
//
// Origen:
//   latest                       la última copia de UPLOAD_DIR/backups (también local:<copia>)
//   external:latest | <copia>    BACKUP_EXTERNAL_DIR
//   s3:latest | <copia>          BACKUP_S3_* (R2, B2, MinIO…)
//   /ruta/pizarro-backup-….pzman una copia en una carpeta (con su carpeta files/ al lado)
// Variables: DATABASE_URL (base de datos de destino, VACÍA), BACKUP_KEY, UPLOAD_DIR y, según el origen, BACKUP_S3_* o
// BACKUP_EXTERNAL_DIR. Detalle paso a paso en docs/INSTALL.md.
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBackupKey } from "@/lib/backup-core";
import { listStems } from "@/lib/backup-dest";
import { findMigrationsDir, parseSource, restoreBackup } from "@/lib/backup-restore";
import { backupsDir, uploadDir } from "@/lib/upload-dir";

const USAGE = `Uso: node dist/restore.mjs <origen> [opciones]

Origen:
  latest | local:<copia>        copia de UPLOAD_DIR/backups (latest = la más reciente)
  external:latest | <copia>     copia de la carpeta BACKUP_EXTERNAL_DIR
  s3:latest | <copia>           copia del almacenamiento S3 (BACKUP_S3_*)
  /ruta/pizarro-backup-….pzman  copia de una carpeta (con su files/ al lado)

Opciones:
  --files         restaura también los ficheros (adjuntos, miniaturas, documentos…) en UPLOAD_DIR
  --files-only    restaura solo los ficheros (p. ej. para reanudar tras un corte)
  --force         BORRA la base de datos de destino aunque tenga datos
  --list          lista las copias del origen y sale
  --migrations D  carpeta de migraciones (por defecto, la de la imagen)

Variables: DATABASE_URL, BACKUP_KEY, UPLOAD_DIR (y BACKUP_S3_* o BACKUP_EXTERNAL_DIR según el origen).`;

function fail(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const mIdx = args.indexOf("--migrations");
  const migrationsArg = mIdx >= 0 ? args[mIdx + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith("--") && !(mIdx >= 0 && i === mIdx + 1));
  if (flags.has("--help") || flags.has("-h") || positional.length !== 1) fail(USAGE);
  for (const f of flags) if (!["--files", "--files-only", "--force", "--list", "--migrations", "--help"].includes(f)) fail(`Opción desconocida: ${f}\n\n${USAGE}`);

  const log = (m: string) => console.log(`[restore] ${m}`);
  const source = parseSource(positional[0]!, { localDir: backupsDir() });

  if (flags.has("--list")) {
    const stems = await listStems(source.dest);
    if (!stems.length) log(`No hay copias en ${source.dest.label}.`);
    for (const s of stems) console.log(`${s.stem}  ${Math.round(s.dumpBytes / 1024)} KB  ${s.hasManifest ? "base de datos + ficheros" : "solo base de datos"}`);
    return;
  }

  const key = parseBackupKey(process.env.BACKUP_KEY);
  if (!key) fail("BACKUP_KEY no está definida o no es válida (32 bytes en base64). Es la misma clave con la que se hicieron las copias.");
  const filesOnly = flags.has("--files-only");
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!filesOnly && !databaseUrl) fail("DATABASE_URL no está definida (base de datos de destino).");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = migrationsArg ? path.resolve(migrationsArg) : findMigrationsDir([path.join(here, "..", "migrator", "prisma", "migrations"), path.join(here, "..", "prisma", "migrations")]);
  if (!filesOnly && !migrationsDir) fail("No se encuentra la carpeta de migraciones (usa --migrations <carpeta>).");

  // Si se ejecuta como root (docker compose run), los ficheros restaurados quedan del dueño de UPLOAD_DIR.
  let owner: { uid: number; gid: number } | null = null;
  if (process.getuid?.() === 0) {
    try {
      const st = await stat(uploadDir());
      if (st.uid !== 0) owner = { uid: st.uid, gid: st.gid };
    } catch {
      // UPLOAD_DIR aún no existe: el arranque de la app ajusta los permisos.
    }
  }

  const started = Date.now();
  const res = await restoreBackup({
    databaseUrl,
    source,
    key,
    migrationsDir: migrationsDir ?? "",
    force: flags.has("--force"),
    database: !filesOnly,
    files: filesOnly || flags.has("--files"),
    uploadRoot: uploadDir(),
    owner,
    log,
  });
  if (res.db) log(`Base de datos restaurada: ${res.db.totalRows} filas en ${res.db.tables.length} tablas (copia del ${res.db.createdAt}).`);
  if (res.manifest && !res.files && !filesOnly) log(`La copia incluye ${res.manifest.fileCount} ficheros: añade --files-only para restaurarlos ahora.`);
  log(`Hecho en ${Math.round((Date.now() - started) / 1000)} s. Arranca la app con normalidad (aplicará lo que falte y no tocará los datos).`);
}

main().catch((err) => {
  console.error("[restore] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
