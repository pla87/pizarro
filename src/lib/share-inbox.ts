import "server-only";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SHARE_MAX_PENDING, SHARE_TTL_MS, type SharedText } from "./share-core";
import { uploadDir } from "./upload-dir";
import { newFileId } from "./uploads";

// Almacén temporal de lo compartido con «Compartir → Pizarro» (api/share): una carpeta por persona y envío en
// UPLOAD_DIR/shared/<usuario>/<envío>/, con los archivos tal cual (0.bin, 1.bin…) y meta.json (textos, nombres y tipos).
// Solo lo lee su dueño (la carpeta lleva su id), caduca a los 30 minutos y se borra al usarlo o descartarlo. Nada de lo
// que hay aquí cuenta como adjunto ni entra en las copias de seguridad: la tarea y sus adjuntos se crean después, con
// «Nueva tarea», por el camino de siempre (límites, cuota y deshacer incluidos).

interface SharedFileMeta {
  name: string;
  type: string;
  size: number;
}
interface ShareMeta extends SharedText {
  createdAt: number;
  files: SharedFileMeta[];
}

const ID = /^[a-z0-9]{1,40}$/i;

/** Carpeta raíz del almacén (la copia de seguridad la excluye). */
export const sharedDir = (): string => path.join(/*turbopackIgnore: true*/ uploadDir(), "shared");

function shareDir(userId: string, shareId: string): string | null {
  if (!ID.test(userId) || !ID.test(shareId)) return null;
  return path.join(/*turbopackIgnore: true*/ sharedDir(), userId, shareId);
}

async function readMeta(dir: string): Promise<ShareMeta | null> {
  try {
    const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as ShareMeta;
    return typeof meta.createdAt === "number" && Array.isArray(meta.files) ? meta : null;
  } catch {
    return null;
  }
}

/** Antigüedad de un envío: la de su meta.json o, si no lo tiene (se cortó al guardarlo), la de su carpeta. */
async function shareAge(dir: string, now: number): Promise<number> {
  const meta = await readMeta(dir);
  if (meta) return now - meta.createdAt;
  return stat(dir).then((s) => now - s.mtimeMs, () => Infinity);
}

/**
 * Guarda un envío y devuelve su id. Primero los archivos y al final meta.json (con un nombre temporal y `rename`): un
 * envío a medias no se puede abrir y lo borra la limpieza. Retira los envíos anteriores de la persona que pasen del tope.
 */
export async function stageShare(userId: string, text: SharedText, files: { name: string; type: string; data: Buffer }[], now = Date.now()): Promise<string> {
  const shareId = newFileId();
  const dir = shareDir(userId, shareId);
  if (!dir) throw new Error("share: id no válido");
  await mkdir(dir, { recursive: true });
  try {
    for (const [i, f] of files.entries()) await writeFile(path.join(dir, `${i}.bin`), f.data);
    const meta: ShareMeta = { ...text, createdAt: now, files: files.map((f) => ({ name: f.name, type: f.type, size: f.data.length })) };
    await writeFile(path.join(dir, "meta.json.tmp"), JSON.stringify(meta));
    await rename(path.join(dir, "meta.json.tmp"), path.join(dir, "meta.json"));
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  await prunePending(userId, shareId, now);
  return shareId;
}

/** Deja como mucho SHARE_MAX_PENDING envíos de la persona (los más recientes) y quita los caducados. */
async function prunePending(userId: string, keep: string, now: number): Promise<void> {
  const root = path.join(/*turbopackIgnore: true*/ sharedDir(), userId);
  const names = await readdir(root).catch(() => [] as string[]);
  const aged = await Promise.all(names.filter((n) => ID.test(n)).map(async (n) => ({ n, age: await shareAge(path.join(root, n), now) })));
  aged.sort((a, b) => a.age - b.age);
  let kept = 0;
  for (const { n, age } of aged) {
    if (n === keep || (age <= SHARE_TTL_MS && kept < SHARE_MAX_PENDING - 1)) {
      if (n !== keep) kept++;
      continue;
    }
    await rm(path.join(root, n), { recursive: true, force: true });
  }
}

/** El envío de la persona, o null si no existe, no es suyo o ha caducado (entonces se borra). */
export async function readShare(userId: string, shareId: string, now = Date.now()): Promise<ShareMeta | null> {
  const dir = shareDir(userId, shareId);
  if (!dir) return null;
  const meta = await readMeta(dir);
  if (!meta) return null;
  if (now - meta.createdAt > SHARE_TTL_MS) {
    await rm(dir, { recursive: true, force: true });
    return null;
  }
  return meta;
}

/** Ruta y datos de un archivo del envío (null si no existe o ha caducado). */
export async function sharedFile(userId: string, shareId: string, index: number, now = Date.now()): Promise<{ path: string; meta: SharedFileMeta } | null> {
  const meta = await readShare(userId, shareId, now);
  const file = Number.isInteger(index) && index >= 0 ? meta?.files[index] : undefined;
  if (!file) return null;
  return { path: path.join(shareDir(userId, shareId)!, `${index}.bin`), meta: file };
}

/** Borra el envío (usado o descartado). */
export async function dropShare(userId: string, shareId: string): Promise<void> {
  const dir = shareDir(userId, shareId);
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Borra los envíos caducados de todo el mundo (tarea de mantenimiento). Devuelve cuántos. */
export async function purgeShares(now = Date.now()): Promise<number> {
  const root = sharedDir();
  let removed = 0;
  for (const user of await readdir(root).catch(() => [] as string[])) {
    const userDir = path.join(root, user);
    const shares = await readdir(userDir).catch(() => [] as string[]);
    for (const n of shares) {
      const dir = path.join(userDir, n);
      if ((await shareAge(dir, now)) <= SHARE_TTL_MS) continue;
      await rm(dir, { recursive: true, force: true });
      removed++;
    }
    if (!(await readdir(userDir).catch(() => [])).length) await rm(userDir, { recursive: true, force: true });
  }
  return removed;
}
