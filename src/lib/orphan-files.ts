import { lstat, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

// Limpieza de ficheros huérfanos en UPLOAD_DIR: los que ninguna fila de la base de datos referencia.
// Muy conservadora: solo regulares (nunca enlaces simbólicos), solo con nombre reconocido, solo dentro
// de la carpeta de subidas y solo con más de 24 h (una subida en curso o recién hecha nunca se toca).

export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Si más de esta fracción de los ficheros parecen huérfanos, algo va mal (¿BD equivocada?): no se borra nada. */
const MAX_ORPHAN_FRACTION = 0.5;
const MIN_FILES_FOR_GUARD = 50;

export interface OrphanReport {
  scanned: number;
  orphans: number;
  deleted: number;
  bytes: number;
  aborted: boolean;
}

/** Id de adjunto que corresponde a un nombre de fichero, o null si no es un fichero nuestro. */
export function parseUploadName(name: string, where: "root" | "releases"): { id: string } | { tmp: true } | null {
  if (/\.tmp$/i.test(name)) return { tmp: true };
  const m = (where === "root" ? /^([a-z0-9]+)(?:\.thumb)?\.(?:webp|bin)$/i : /^([a-z0-9]+)\.(?:webp|bin)$/i).exec(name);
  return m ? { id: m[1]! } : null;
}

/** ¿`target` queda dentro de `root`? (sin salir con «..»; los dos ya resueltos). */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Borra los ficheros de `dir` (raíz) y `dir/releases` que no estén en los conjuntos de ids conocidos.
 * `dryRun` solo cuenta. Nunca lanza por un fichero concreto.
 */
export async function cleanOrphanFiles(
  dir: string,
  known: { attachments: Set<string>; releaseAttachments: Set<string> },
  opts: { now?: number; dryRun?: boolean; minAgeMs?: number } = {},
): Promise<OrphanReport> {
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const report: OrphanReport = { scanned: 0, orphans: 0, deleted: 0, bytes: 0, aborted: false };
  let root: string;
  try {
    root = await realpath(dir);
  } catch {
    return report; // La carpeta aún no existe: nada que limpiar.
  }

  const candidates: { file: string; size: number }[] = [];
  const scan = async (folder: string, where: "root" | "releases", ids: Set<string>) => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Solo ficheros regulares: los enlaces simbólicos y las carpetas (p. ej. backups/) no se tocan.
      if (!entry.isFile()) continue;
      const parsed = parseUploadName(entry.name, where);
      if (!parsed) continue;
      const file = path.join(folder, entry.name);
      if (!isInside(root, file)) continue;
      let st;
      try {
        st = await lstat(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.isSymbolicLink()) continue;
      report.scanned++;
      if (now - st.mtimeMs < minAge) continue;
      if ("id" in parsed && ids.has(parsed.id)) continue;
      candidates.push({ file, size: st.size });
    }
  };
  await scan(root, "root", known.attachments);
  await scan(path.join(root, "releases"), "releases", known.releaseAttachments);

  report.orphans = candidates.length;
  report.bytes = candidates.reduce((n, c) => n + c.size, 0);
  if (report.scanned >= MIN_FILES_FOR_GUARD && candidates.length > report.scanned * MAX_ORPHAN_FRACTION) {
    report.aborted = true;
    return report;
  }
  if (opts.dryRun) return report;
  for (const c of candidates) {
    try {
      // Se vuelve a comprobar justo antes de borrar: que siga siendo un fichero regular.
      const st = await lstat(c.file);
      if (!st.isFile() || st.isSymbolicLink()) continue;
      await unlink(c.file);
      report.deleted++;
    } catch {
      // Desapareció o no se puede borrar: se ignora.
    }
  }
  return report;
}
