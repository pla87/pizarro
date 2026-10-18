/** Error con mensaje apto para mostrar al usuario. */
export class AppError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = () => new AppError("No encontrado o sin acceso.", 404);
export const forbidden = () => new AppError("No tienes permiso para esta acción.", 403);
