import { esT, type T, type Vars } from "../../i18n/shared";
import { AppError } from "../errors";

/** Detalle técnico: texto tal cual (nombres, rutas) o una frase con datos, que se traduce al idioma de quien lee. */
type ArchiveDetail = string | { k: string; p?: Vars };

/** Frases con datos de zip-read.ts (el resto de sus mensajes son fijos y se traducen enteros). */
const ZIP_DYNAMIC = /^(Nombre de entrada no válido|Entrada repetida): ([\s\S]*)$/;

/** «nombre» + frase fija (zip-read.ts). */
const ZIP_QUOTED = /^«([\s\S]*)» (es demasiado grande\.|es mayor de lo declarado\.|está dañado \(CRC-32\)\.?|está incompleto\.)$/;

/** Detalle de un fallo de lectura del ZIP (ZipReadError.message), traducible. */
export function zipDetail(message: string): ArchiveDetail {
  const m = ZIP_DYNAMIC.exec(message);
  if (m) return { k: `${m[1]}: {name}`, p: { name: m[2]! } };
  const q = ZIP_QUOTED.exec(message);
  return q ? { k: `«{name}» ${q[2]}`, p: { name: q[1]! } } : { k: message };
}

/**
 * Error de un archivo de importación: `base` es un texto fijo (se traduce) y `detail` el dato técnico concreto
 * (ruta del fallo, nombre de la entrada…), que se muestra tal cual a continuación.
 */
export class ArchiveError extends AppError {
  readonly detail?: string;
  constructor(readonly base: string, private readonly detailSource?: ArchiveDetail) {
    super(base);
    this.name = "ArchiveError";
    this.detail = detailSource === undefined ? undefined : typeof detailSource === "string" ? detailSource : esT(detailSource.k, detailSource.p);
    if (this.detail) this.message = `${base} (${this.detail})`;
  }

  /** Mensaje para quien importa, en su idioma: la frase fija y, entre paréntesis, el detalle técnico. */
  text(t: T): string {
    const d = this.detailSource;
    const detail = d === undefined ? "" : typeof d === "string" ? d : t(d.k, d.p);
    return `${t(this.base)}${detail ? ` (${detail})` : ""}`;
  }
}

/** Error de una exportación o importación cortada por un reinicio (lo pone el trabajador, transfer-jobs.ts, y la importación al apagarse). */
export const INTERRUPTED_MESSAGE = "Interrumpido por un reinicio";
