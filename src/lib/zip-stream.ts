// Escritor ZIP en flujo, solo almacenamiento (sin compresión) y sin ZIP64: se emite entrada a entrada sin juntar el
// ZIP en memoria. Cada entrada declara de antemano su tamaño y su CRC-32 (el exportador de proyectos ya recorre los
// ficheros una vez para calcular su huella), así que no hacen falta descriptores de datos y cualquier lector lo abre.
import { crc32 } from "node:zlib";

export interface StreamZipEntry {
  /** Ruta dentro del ZIP (UTF-8, sin «..» ni barras iniciales). */
  name: string;
  size: number;
  /** CRC-32 del contenido (sin signo). */
  crc: number;
  /** Contenido: en memoria o como flujo; debe producir exactamente `size` bytes con ese CRC. */
  body: Buffer | (() => AsyncIterable<Buffer | Uint8Array>);
}

const ZIP_LIMIT = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const LOCAL = 30;
const CENTRAL = 46;
const END = 22;

/** Bytes que ocupará el ZIP entero (para la cabecera Content-Length); lanza si no cabe sin ZIP64. */
export function streamZipSize(entries: Pick<StreamZipEntry, "name" | "size">[]): number {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error("Demasiados ficheros para un ZIP sin ZIP64.");
  let total = END;
  for (const e of entries) total += LOCAL + CENTRAL + 2 * Buffer.byteLength(e.name, "utf8") + e.size;
  if (total > ZIP_LIMIT) throw new Error("El ZIP supera los 4 GB.");
  return total;
}

/** Genera el ZIP por trozos. Si una entrada no cuadra con lo declarado (tamaño o CRC), lanza: el flujo queda cortado. */
export async function* streamZip(entries: StreamZipEntry[], now = new Date()): AsyncGenerator<Buffer> {
  streamZipSize(entries);
  const stamp = dosDateTime(now);
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(LOCAL);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // bit 11: nombre en UTF-8
    local.writeUInt16LE(0, 8); // almacenado
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(e.crc >>> 0, 14);
    local.writeUInt32LE(e.size, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(CENTRAL);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(stamp.time, 12);
    entry.writeUInt16LE(stamp.date, 14);
    entry.writeUInt32LE(e.crc >>> 0, 16);
    entry.writeUInt32LE(e.size, 20);
    entry.writeUInt32LE(e.size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    yield local;
    yield name;
    let written = 0;
    let crc = 0;
    if (Buffer.isBuffer(e.body)) {
      written = e.body.length;
      crc = crc32(e.body);
      if (written) yield e.body;
    } else {
      for await (const chunk of e.body()) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        written += buf.length;
        crc = crc32(buf, crc);
        if (written > e.size) throw new Error(`«${e.name}» ha crecido mientras se exportaba.`);
        yield buf;
      }
    }
    if (written !== e.size || crc >>> 0 !== e.crc >>> 0) throw new Error(`«${e.name}» ha cambiado mientras se exportaba.`);
    offset += LOCAL + name.length + e.size;
  }
  const centralBuf = Buffer.concat(central);
  yield centralBuf;
  const end = Buffer.alloc(END);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  yield end;
}
