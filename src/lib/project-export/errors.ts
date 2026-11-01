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
