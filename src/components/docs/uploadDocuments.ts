import type { T } from "@/i18n/core";
import { withRetry } from "@/lib/upload-queue";

/** Nombre con el que se sube un archivo: las capturas pegadas llegan como «image.png» y se les da uno con fecha. */
export function documentUploadName(file: File, t: T): string {
  return file.name && file.name !== "image.png" ? file.name : `${t("captura")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
}

/** Respuesta de error del servidor, con lo que necesita withRetry para decidir si reintentar (429/503 y Retry-After). */
class DocumentUploadError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSec: number | null) {
    super(message);
  }
}

/**
 * Sube un archivo a la documentación del proyecto (el servidor aplica sus límites: tamaño, número, cuota, tipo).
 * Con `fileMaxMb` se rechaza antes de enviarlo si ya se sabe que no cabe. Como los adjuntos, reintenta con calma si el
 * servidor está ocupado o se ha llegado al tope de subidas por minuto (429/503, esperando lo que diga Retry-After).
 */
export async function uploadDocument(projectId: string, file: File, t: T, fileMaxMb?: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fileMaxMb && file.size > fileMaxMb * 1024 * 1024) {
    return { ok: false, error: t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: fileMaxMb }) };
  }
  try {
    await withRetry(async () => {
      const body = new FormData();
      body.append("file", file, documentUploadName(file, t));
      const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body });
      if (res.ok) return;
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      const retryAfter = Number(res.headers.get("Retry-After"));
      throw new DocumentUploadError(json.error ?? t("No se pudo subir el archivo."), res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof DocumentUploadError ? err.message : t("No se pudo subir el archivo.") };
  }
}
