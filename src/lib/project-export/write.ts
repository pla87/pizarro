import "server-only";
import { createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { streamZip, type StreamZipEntry } from "../zip-stream";
import type { ProjectExport } from "./export";

/**
 * Escribe el ZIP de una exportación en `dest` (primero en un temporal junto a él y luego se renombra, así nunca queda un
 * archivo a medias con el nombre final). `onFile(hechos, total)` avisa al terminar cada fichero adjunto. Si falla, borra el temporal.
 */
export async function writeProjectExport(built: ProjectExport, dest: string, onFile?: (done: number, total: number) => void, tmpPath?: string): Promise<number> {
  // `tmpPath`: nombre propio del temporal (p. ej. uno por intento), para que dos ejecuciones del mismo trabajo no pisen el mismo fichero.
  const tmp = tmpPath ?? `${dest}.tmp`;
  const total = built.entries.filter((e) => !Buffer.isBuffer(e.body)).length;
  let done = 0;
  const entries: StreamZipEntry[] = built.entries.map((e) => {
    if (Buffer.isBuffer(e.body)) return e;
    const open = e.body;
    return { ...e, body: async function* () { yield* open(); onFile?.(++done, total); } };
  });
  onFile?.(0, total);
  try {
    await pipeline(Readable.from(streamZip(entries), { objectMode: false }), createWriteStream(tmp));
    const size = (await stat(tmp)).size;
    if (size !== built.size) throw new Error(`El archivo escrito (${size} B) no mide lo previsto (${built.size} B).`);
    await rename(tmp, dest);
    return size;
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
