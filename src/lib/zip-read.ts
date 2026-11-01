// Lector ZIP sobre un fichero en disco (acceso aleatorio por el directorio central), sin dependencias.
// Pensado para archivos que no son de fiar: no extrae nada a disco por su cuenta, rechaza cifrado, ZIP64 y varios
// discos, y limita el número de entradas, los nombres y lo que se descomprime (CRC-32 y tamaño declarado se comprueban al leer).
import { crc32, createInflateRaw } from "node:zlib";
import { open, type FileHandle } from "node:fs/promises";

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipReadError";
  }
}

export interface ZipEntryInfo {
  name: string;
  /** 0 = almacenado, 8 = deflate. */
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export interface ZipReadLimits {
  maxEntries: number;
  /** Suma de los tamaños descomprimidos declarados. */
  maxTotalSize: number;
  /** Cuánto puede inflarse una entrada comprimida respecto a su tamaño comprimido. */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipReadLimits = { maxEntries: 100_000, maxTotalSize: 8 * 1024 ** 3, maxRatio: 1000 };

/** ¿Es un nombre de entrada seguro? Relativo, sin «..», sin barras invertidas, sin NUL ni unidades de Windows. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 300 || name.includes("\0") || name.includes("\\")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Tope absoluto del directorio central (se reserva entero en memoria). */
const MAX_CD_BYTES = 64 * 1024 * 1024;

export class ZipFile {
  private constructor(private readonly fh: FileHandle, readonly entries: ZipEntryInfo[], private readonly fileSize: number) {}

  static async open(file: string, limits: ZipReadLimits = DEFAULT_ZIP_LIMITS): Promise<ZipFile> {
    const fh = await open(file, "r");
    try {
      const size = (await fh.stat()).size;
      if (size < 22) throw new ZipReadError("El archivo no es un ZIP.");
      // Registro de fin de directorio central: dentro de los últimos 22 + 65535 bytes.
      const tailLen = Math.min(size, 22 + 0xffff);
      const tail = Buffer.alloc(tailLen);
      await fh.read(tail, 0, tailLen, size - tailLen);
      let eocd = -1;
      for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new ZipReadError("El archivo no es un ZIP.");
      const disk = tail.readUInt16LE(eocd + 4);
      const cdDisk = tail.readUInt16LE(eocd + 6);
      const count = tail.readUInt16LE(eocd + 10);
      const cdSize = tail.readUInt32LE(eocd + 12);
      const cdOffset = tail.readUInt32LE(eocd + 16);
      if (disk !== 0 || cdDisk !== 0) throw new ZipReadError("ZIP de varios discos no admitido.");
      if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipReadError("ZIP64 no admitido.");
      if (count > limits.maxEntries) throw new ZipReadError("El ZIP tiene demasiadas entradas.");
      if (cdOffset + cdSize > size || cdSize > Math.min(MAX_CD_BYTES, count * (46 + 3 * 1024) + 1)) throw new ZipReadError("Directorio central no válido.");
      const cd = Buffer.alloc(cdSize);
      if (cdSize) await fh.read(cd, 0, cdSize, cdOffset);
      const entries: ZipEntryInfo[] = [];
      const seen = new Set<string>();
      let total = 0;
      let p = 0;
      for (let n = 0; n < count; n++) {
        if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipReadError("Directorio central no válido.");
        const flags = cd.readUInt16LE(p + 8);
        const method = cd.readUInt16LE(p + 10);
        const crc = cd.readUInt32LE(p + 16);
        const compressedSize = cd.readUInt32LE(p + 20);
        const usize = cd.readUInt32LE(p + 24);
        const nameLen = cd.readUInt16LE(p + 28);
        const extraLen = cd.readUInt16LE(p + 30);
        const commentLen = cd.readUInt16LE(p + 32);
        const offset = cd.readUInt32LE(p + 42);
        if (p + 46 + nameLen > cd.length) throw new ZipReadError("Directorio central no válido.");
        const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
        p += 46 + nameLen + extraLen + commentLen;
        if (flags & 1) throw new ZipReadError("ZIP cifrado no admitido.");
        if (method !== 0 && method !== 8) throw new ZipReadError("Método de compresión no admitido.");
        if (compressedSize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw new ZipReadError("ZIP64 no admitido.");
        if (!isSafeEntryName(name)) throw new ZipReadError(`Nombre de entrada no válido: ${name.slice(0, 80)}`);
        const key = name.toLowerCase();
        if (seen.has(key)) throw new ZipReadError(`Entrada repetida: ${name}`);
        seen.add(key);
        if (method === 0 && compressedSize !== usize) throw new ZipReadError("Entrada inconsistente.");
        if (method === 8 && usize > compressedSize * limits.maxRatio + 1024) throw new ZipReadError("Entrada con una compresión sospechosa.");
        if (offset + compressedSize > size) throw new ZipReadError("Entrada fuera del archivo.");
        total += usize;
        if (total > limits.maxTotalSize) throw new ZipReadError("El contenido del ZIP es demasiado grande.");
        entries.push({ name, method, crc, compressedSize, size: usize, offset });
      }
      return new ZipFile(fh, entries, size);
    } catch (err) {
      await fh.close().catch(() => {});
      throw err;
    }
  }

  find(name: string): ZipEntryInfo | undefined {
    return this.entries.find((e) => e.name === name);
  }

  /** Posición del primer byte de datos (tras la cabecera local, cuyo nombre debe coincidir con el del directorio central). */
  private async dataStart(e: ZipEntryInfo): Promise<number> {
    const head = Buffer.alloc(30);
    const { bytesRead } = await this.fh.read(head, 0, 30, e.offset);
    if (bytesRead < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new ZipReadError("Cabecera local no válida.");
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const nameBuf = Buffer.alloc(nameLen);
    await this.fh.read(nameBuf, 0, nameLen, e.offset + 30);
    if (nameBuf.toString("utf8") !== e.name) throw new ZipReadError("La cabecera local no coincide con el directorio central.");
    const start = e.offset + 30 + nameLen + extraLen;
    if (start + e.compressedSize > this.fileSize) throw new ZipReadError("Entrada fuera del archivo.");
    return start;
  }

  /** Contenido descomprimido por trozos. Comprueba que no supera el tamaño declarado y, al final, tamaño y CRC-32. */
  async *read(e: ZipEntryInfo): AsyncGenerator<Buffer> {
    const start = await this.dataStart(e);
    let produced = 0;
    let crc = 0;
    const check = (buf: Buffer) => {
      produced += buf.length;
      if (produced > e.size) throw new ZipReadError(`«${e.name}» es mayor de lo declarado.`);
      crc = crc32(buf, crc);
    };
    if (e.method === 0) {
      const chunk = 256 * 1024;
      for (let pos = 0; pos < e.compressedSize; pos += chunk) {
        const len = Math.min(chunk, e.compressedSize - pos);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await this.fh.read(buf, 0, len, start + pos);
        if (bytesRead !== len) throw new ZipReadError("Archivo truncado.");
        check(buf);
        yield buf;
      }
    } else {
      const inflater = createInflateRaw();
      const feed = (async () => {
        try {
          const chunk = 64 * 1024;
          for (let pos = 0; pos < e.compressedSize; pos += chunk) {
            const len = Math.min(chunk, e.compressedSize - pos);
            const buf = Buffer.alloc(len);
            const { bytesRead } = await this.fh.read(buf, 0, len, start + pos);
            if (bytesRead !== len) throw new ZipReadError("Archivo truncado.");
            if (!inflater.write(buf)) await new Promise<void>((res) => inflater.once("drain", () => res()));
          }
          inflater.end();
        } catch (err) {
          inflater.destroy(err as Error);
        }
      })();
      try {
        for await (const buf of inflater) {
          check(buf as Buffer);
          yield buf as Buffer;
        }
      } catch (err) {
        if (err instanceof ZipReadError) throw err;
        throw new ZipReadError("Datos comprimidos dañados.");
      } finally {
        inflater.destroy();
        await feed.catch(() => {});
      }
    }
    if (produced !== e.size) throw new ZipReadError(`«${e.name}» está incompleto.`);
    if (crc >>> 0 !== e.crc >>> 0) throw new ZipReadError(`«${e.name}» está dañado (CRC-32).`);
  }

  /** Lee la entrada entera en memoria; lanza si supera `maxBytes`. */
  async readAll(e: ZipEntryInfo, maxBytes: number): Promise<Buffer> {
    if (e.size > maxBytes) throw new ZipReadError(`«${e.name}» es demasiado grande.`);
    const parts: Buffer[] = [];
    for await (const c of this.read(e)) parts.push(c);
    return Buffer.concat(parts);
  }

  async close(): Promise<void> {
    await this.fh.close().catch(() => {});
  }
}
