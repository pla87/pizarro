import "server-only";
import { crc32 } from "node:zlib";
import { streamZip, streamZipSize, type StreamZipEntry } from "./zip-stream";
import { zipPlanToken } from "./zip-token";
import { planPackages, zipEntryOverhead, type ZipPackage } from "./zip-plan";
import { runQueue } from "./upload-queue";

/** Un fichero que puede ir en un ZIP de release: su tamaño ya está comprobado en disco. */
export interface ZipEntry {
  /** Id del adjunto (entra en el token de versión del plan). */
  id: string;
  name: string;
  size: number;
  /** Contenido en flujo (se lee dos veces: una para el CRC y otra al enviar). */
  open: () => AsyncIterable<Buffer | Uint8Array>;
}

/** Consultas de tamaño en disco a la vez al preparar un ZIP (antes, una tras otra: cientos de adjuntos tardaban). */
const ZIP_STAT_CONCURRENCY = 16;

/**
 * Entradas del ZIP con su tamaño en disco, en el mismo orden que `candidates`. `size` devuelve null si el fichero ya
 * no está: se omite en lugar de romper toda la descarga. Las consultas van en paralelo, como mucho 16 a la vez.
 */
export async function sizedZipEntries<C extends Omit<ZipEntry, "size">>(candidates: readonly C[], size: (c: C) => Promise<number | null>): Promise<ZipEntry[]> {
  const sizes = await runQueue(candidates, size, { concurrency: ZIP_STAT_CONCURRENCY });
  const entries: ZipEntry[] = [];
  for (const [i, r] of sizes.entries()) {
    if (r.status === "rejected") throw r.reason;
    const { id, name, open } = candidates[i]!;
    if (r.value !== null) entries.push({ id, name, size: r.value, open });
  }
  return entries;
}

/** Reparto de las entradas en paquetes de como mucho `maxMb` MB (un fichero mayor va solo y marcado). */
export function planZipEntries(entries: ZipEntry[], maxMb: number): ZipPackage[] {
  return planPackages(
    entries.map((e, index) => ({ index, size: e.size + zipEntryOverhead(e.name) })),
    maxMb * 1024 * 1024,
  );
}

/** Cuerpo JSON del modo «plan»: cuántos paquetes hay y qué pesa cada uno. */
export function zipPlanBody(packages: ZipPackage[], maxMb: number, entries: ZipEntry[]) {
  return { maxMb, v: zipPlanToken(entries, maxMb), parts: packages.map((p) => ({ files: p.items.length, bytes: p.bytes, oversize: p.oversize })) };
}

/** Un paquete listo para enviarse en flujo: sus entradas con tamaño y CRC ya medidos y lo que ocupará el ZIP. */
interface ZipPart {
  entries: StreamZipEntry[];
  /** Bytes exactos del ZIP (Content-Length). */
  bytes: number;
}

/** Lee una vez en flujo el contenido de una entrada para medir su tamaño real y su CRC-32; null si no se puede leer. */
async function measure(e: ZipEntry): Promise<{ size: number; crc: number } | null> {
  try {
    let size = 0;
    let crc = 0;
    for await (const chunk of e.open()) {
      size += chunk.byteLength;
      crc = crc32(chunk, crc);
    }
    return { size, crc: crc >>> 0 };
  } catch {
    // Fichero ausente en disco (o ilegible): se omite en lugar de romper toda la descarga.
    return null;
  }
}

/**
 * Prepara un paquete sin juntarlo en memoria: una primera pasada en flujo mide el tamaño y el CRC de cada fichero
 * (los que ya no están se omiten) y después `zipPartBody` lo envía en flujo. La memoria no depende del tamaño del paquete.
 */
export async function prepareZipPart(entries: ZipEntry[], pkg: ZipPackage): Promise<ZipPart> {
  const out: StreamZipEntry[] = [];
  for (const i of pkg.items) {
    const e = entries[i]!;
    const m = await measure(e);
    if (m) out.push({ name: e.name, size: m.size, crc: m.crc, body: e.open });
  }
  return { entries: out, bytes: out.length ? streamZipSize(out) : 0 };
}

// Cada paquete se lee dos veces del disco (CRC y envío) y su envío puede durar minutos: uno a la vez por persona y
// como mucho dos en todo el servidor, para que varias descargas en paralelo no saturen el disco ni la red.
const zipSlots = ((globalThis as unknown as { __pzZipSlots?: { users: Set<string>; active: number } }).__pzZipSlots ??= { users: new Set(), active: 0 });
const MAX_ZIPS_AT_ONCE = 2;

/** Reserva un hueco para preparar y enviar un ZIP; null si esa persona ya tiene uno en curso o el servidor está lleno. Llama a la función devuelta al terminar. */
export function acquireZipSlot(userId: string): (() => void) | null {
  if (zipSlots.users.has(userId) || zipSlots.active >= MAX_ZIPS_AT_ONCE) return null;
  zipSlots.users.add(userId);
  zipSlots.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    zipSlots.users.delete(userId);
    zipSlots.active--;
  };
}

/** Tamaño de cada trozo con que se envía un ZIP que ya está en memoria. */
const ZIP_SEND_CHUNK = 1024 * 1024;
/** Por si la descarga ni termina ni se cancela (conexión abandonada sin aviso): el hueco se suelta igualmente. */
const ZIP_SEND_MAX_MS = 15 * 60 * 1000;

/**
 * Cuerpo de respuesta que entrega el ZIP según lo pide el cliente (un buffer, a trozos de 1 MB, o un flujo de trozos)
 * y suelta el hueco de acquireZipSlot al dar el último trozo, si falla, si se cancela la descarga o se aborta la
 * petición (o, como muy tarde, a los 15 min): mientras se envía, el ZIP debe seguir contando como uno en curso.
 */
export function zipBodyStream(zip: Uint8Array | AsyncIterable<Uint8Array>, release: () => void, opts: { signal?: AbortSignal; chunk?: number } = {}): ReadableStream<Uint8Array> {
  const chunk = opts.chunk ?? ZIP_SEND_CHUNK;
  let pos = 0;
  const iterator = zip instanceof Uint8Array ? null : zip[Symbol.asyncIterator]();
  const timer = setTimeout(() => done(), ZIP_SEND_MAX_MS);
  timer.unref?.();
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stop);
    release();
  };
  // Descarga cancelada o petición abortada: además se cierra el fichero que se estuviera leyendo.
  const stop = () => {
    done();
    void iterator?.return?.()?.catch(() => {});
  };
  if (opts.signal?.aborted) stop();
  else opts.signal?.addEventListener("abort", stop, { once: true });
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (iterator) {
          let next: IteratorResult<Uint8Array>;
          try {
            next = await iterator.next();
          } catch (err) {
            done();
            controller.error(err);
            return;
          }
          try {
            if (next.done) {
              done();
              controller.close();
            } else controller.enqueue(next.value);
          } catch {
            // El flujo ya se canceló mientras se leía el trozo.
          }
          return;
        }
        const buf = zip as Uint8Array;
        const end = Math.min(pos + chunk, buf.length);
        if (end > pos) controller.enqueue(buf.subarray(pos, end));
        pos = end;
        if (pos >= buf.length) {
          done();
          controller.close();
        }
      },
      cancel() {
        stop();
      },
    },
    // Sin cola: cada trozo se lee solo cuando el cliente pide el siguiente.
    { highWaterMark: 0 },
  );
}

/** Cuerpo de respuesta de un paquete preparado con prepareZipPart: se escribe en flujo, fichero a fichero. */
export function zipPartBody(part: ZipPart, release: () => void, opts: { signal?: AbortSignal; now?: Date } = {}): ReadableStream<Uint8Array> {
  return zipBodyStream(streamZip(part.entries, opts.now), release, opts);
}

/** Tope por petición: el plan tiene el suyo (se consulta al abrir cada release del histórico), los paquetes pedidos por número otro. */
export function zipRateKey(mode: ZipRequestMode, userId: string): { key: string; limit: number } {
  if (mode.kind === "plan") return { key: `release-zip-plan:${userId}`, limit: 60 };
  return mode.explicit ? { key: `release-zip-part:${userId}`, limit: 120 } : { key: `release-zip:${userId}`, limit: 10 };
}

type ZipRequestMode = { kind: "plan" } | { kind: "part"; part: number; explicit: boolean; version: string | null };

/** Respuesta 409 cuando el token `?v=` ya no coincide con el reparto actual; null si coincide o no se envió (enlaces antiguos). */
export function zipVersionConflict(mode: ZipRequestMode, entries: ZipEntry[], maxMb: number, message: string): Response | null {
  if (mode.kind !== "part" || mode.version === null || mode.version === zipPlanToken(entries, maxMb)) return null;
  return new Response(message, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

/** `?plan=1` pide el reparto; `?part=N` (1-based) un paquete (con `?v=` el token del plan); sin nada, el primero. */
export function zipRequestMode(url: string): ZipRequestMode | null {
  const sp = new URL(url).searchParams;
  if (sp.get("plan") === "1") return { kind: "plan" };
  const raw = sp.get("part");
  const version = sp.get("v");
  if (version !== null && !/^[0-9a-f]{16}$/.test(version)) return null;
  if (raw === null) return { kind: "part", part: 1, explicit: false, version };
  const part = Number(raw);
  return Number.isInteger(part) && part >= 1 && part <= 1000 ? { kind: "part", part, explicit: true, version } : null;
}
