import type { T } from "@/i18n/core";

/** Nombre con el que se sube un archivo: las capturas pegadas llegan como «image.png» y se les da uno con fecha. */
export function documentUploadName(file: File, t: T): string {
  return file.name && file.name !== "image.png" ? file.name : `${t("captura")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
}

/**
 * Sube un archivo a la documentación del proyecto (el servidor aplica sus límites: tamaño, número, cuota, tipo).
 * Con `fileMaxMb` se rechaza antes de enviarlo si ya se sabe que no cabe.
 */
export async function uploadDocument(projectId: string, file: File, t: T, fileMaxMb?: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fileMaxMb && file.size > fileMaxMb * 1024 * 1024) {
    return { ok: false, error: t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: fileMaxMb }) };
  }
  try {
    const body = new FormData();
    body.append("file", file, documentUploadName(file, t));
    const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error ?? t("No se pudo subir el archivo.") };
    return { ok: true };
  } catch {
    return { ok: false, error: t("No se pudo subir el archivo.") };
  }
}
