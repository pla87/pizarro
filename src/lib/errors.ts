/** Error con mensaje apto para mostrar al usuario. */
export class AppError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code?: string) {
    super(message);
    this.name = "AppError";
  }
}

// Mensajes por defecto de zod (en inglés: «Invalid input», «Too big: …», «Unrecognized key: …»). Los esquemas con texto
// propio lo dan en español; uno de estos solo llega con una petición forjada (p. ej. dos destinos a la vez).
const ZOD_DEFAULT = /^(Invalid( |$)|Too (big|small):|Unrecognized keys?:)/;

/** Texto para el usuario de un error de validación: el propio del esquema o, si es el de zod por defecto, «Datos no válidos.». */
export function zodIssueMessage(message: string | undefined): string {
  return !message || ZOD_DEFAULT.test(message) ? "Datos no válidos." : message;
}

export const notFound = () => new AppError("No encontrado o sin acceso.", 404);
export const forbidden = () => new AppError("No tienes permiso para esta acción.", 403);
