// Escritor ZIP mínimo, solo almacenamiento (sin compresión: los WebP ya van comprimidos).
import { crc32 } from "node:zlib";

interface ZipFile {
  /** Ruta dentro del ZIP (UTF-8). */
  name: string;
  data: Uint8Array;
}

/** Fecha y hora locales en formato MS-DOS. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function buildZip(files: ZipFile[], now = new Date()): Buffer {
  if (files.length > 0xffff) throw new Error("Demasiados ficheros para un ZIP sin ZIP64.");
  const stamp = dosDateTime(now);
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    const crc = crc32(data);
    if (offset + data.length + name.length + 30 > 0xffffffff) throw new Error("El ZIP supera los 4 GB.");

    // Cabecera local.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // bit 11: nombre en UTF-8
    local.writeUInt16LE(0, 8); // método: almacenado
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // sin campo extra

    // Entrada del directorio central.
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // versión de creación
    entry.writeUInt16LE(20, 6); // versión necesaria
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(stamp.time, 12);
    entry.writeUInt16LE(stamp.date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    // 30..41: extra, comentario, disco, atributos internos: a cero.
    entry.writeUInt32LE(offset, 42);

    chunks.push(local, name, data);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); // entradas en este disco
  end.writeUInt16LE(files.length, 10); // entradas totales
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}
