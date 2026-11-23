import { AppError } from "../errors";

/**
 * Error de un archivo de importación: `base` es un texto fijo (se traduce) y `detail` el dato técnico concreto
 * (ruta del fallo, nombre de la entrada…), que se muestra tal cual a continuación.
 */
export class ArchiveError extends AppError {
  constructor(readonly base: string, readonly detail?: string) {
    super(detail ? `${base} (${detail})` : base);
    this.name = "ArchiveError";
  }
}

/** Error de una exportación o importación cortada por un reinicio (lo pone el trabajador, transfer-jobs.ts, y la importación al apagarse). */
export const INTERRUPTED_MESSAGE = "Interrumpido por un reinicio";
