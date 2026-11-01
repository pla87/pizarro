// Mejora de exportaciones antiguas al formato actual antes de validarlas, para que las versiones futuras de la
// aplicación sigan importando archivos de versiones anteriores.
import { AppError } from "../errors";
import { EXPORT_FORMAT_VERSION, type ExportManifest } from "./types";

/** Paso que lleva los datos (JSON sin validar) de la versión N a la N+1. Para la 1 no hay pasos: es el formato actual. */
type Step = (data: unknown, manifest: ExportManifest) => unknown;
export const UPGRADE_STEPS: Record<number, Step> = {
  // 1: (data) => ({ ...(data as object), campoNuevo: [] }),  ← así se añadiría el paso 1→2
};

/** Rechaza ya (antes de leer nada más) un archivo de una versión que esta aplicación no puede importar. */
export function assertSupportedVersion(manifest: Pick<ExportManifest, "formatVersion">, target = EXPORT_FORMAT_VERSION): void {
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 1) throw new AppError("La versión del formato del archivo no es válida.");
  if (manifest.formatVersion > target) {
    throw new AppError("El archivo se exportó con una versión más reciente de Pizarro. Actualiza esta instalación para importarlo.");
  }
  for (let v = manifest.formatVersion; v < target; v++) {
    if (!UPGRADE_STEPS[v]) throw new AppError("No se puede importar un archivo de una versión tan antigua del formato.");
  }
}

/**
 * Lleva `data` y `manifest` a EXPORT_FORMAT_VERSION. Para la versión 1 es la identidad.
 * Rechaza versiones posteriores a la de esta aplicación (hay que actualizar Pizarro para importarlas).
 */
export function upgrade(manifest: ExportManifest, data: unknown, target = EXPORT_FORMAT_VERSION): { manifest: ExportManifest; data: unknown } {
  assertSupportedVersion(manifest, target);
  let current = data;
  let version = manifest.formatVersion;
  while (version < target) {
    const step = UPGRADE_STEPS[version];
    if (!step) throw new AppError("No se puede importar un archivo de una versión tan antigua del formato.");
    current = step(current, manifest);
    version++;
  }
  return { manifest: { ...manifest, formatVersion: version }, data: current };
}
