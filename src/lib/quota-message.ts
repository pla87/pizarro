import { AppError } from "./errors";
import type { QuotaExceeded } from "./quota";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Dónde se libera espacio o se amplía la cuota de un proyecto (el cliente lo convierte en enlace). */
export const projectStoragePath = (projectId: string) => `/p/${projectId}/settings?tab=adjuntos`;
export const ADMIN_STORAGE_PATH = "/admin/settings";

/**
 * Error de cuota superada con qué hacer: liberar espacio en los ajustes del proyecto o pedir que amplíen la cuota; a un
 * administrador se le añade la ruta (los avisos la pintan como enlace). `projectId` null: proyecto aún sin crear (importación).
 */
export function quotaError(t: T, q: QuotaExceeded, opts: { projectId: string | null; isAdmin: boolean }): AppError {
  const vars = { used: q.usedMb, limit: q.limitMb };
  if (q.scope === "total") {
    return new AppError(
      opts.isAdmin
        ? t("Cuota total de almacenamiento del servidor superada ({used} de {limit} MB). Libera espacio o amplíala en Administración → Ajustes: {link}", { ...vars, link: ADMIN_STORAGE_PATH })
        : t("Cuota total de almacenamiento del servidor superada ({used} de {limit} MB). Pide a un administrador que la amplíe o que libere espacio."),
      413,
      "quota_total",
    );
  }
  if (!opts.projectId) {
    return new AppError(
      t("Cuota de almacenamiento superada ({used} de {limit} MB). Libera espacio en otro proyecto o amplía la cuota en Administración → Ajustes.", vars),
      413,
      "quota_project",
    );
  }
  return new AppError(
    opts.isAdmin
      ? t("Cuota de almacenamiento del proyecto superada ({used} de {limit} MB). Libera espacio o amplía la cuota en Ajustes del proyecto → Adjuntos y límites: {link}", { ...vars, link: projectStoragePath(opts.projectId) })
      : t("Cuota de almacenamiento del proyecto superada ({used} de {limit} MB). Libera espacio en Ajustes del proyecto → Adjuntos y límites, o pide a un administrador que la amplíe.", vars),
    413,
    "quota_project",
  );
}
