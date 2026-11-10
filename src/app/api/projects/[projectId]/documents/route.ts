import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertProjectAccess } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { actionContext } from "@/lib/action-context";
import { logEvent } from "@/lib/log";
import { publishChange } from "@/lib/realtime";
import { rateLimit, rateLimitRetryAfterSec } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser, requireUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { quotaError } from "@/lib/quota-message";
import { roundMb } from "@/lib/attachment-limit";
import { confirmDocumentKind, detectDocumentKind, documentMime, sanitizeDocumentName, type DocumentKindName } from "@/lib/document-kind";
import { createDocumentWithinLimit } from "@/lib/documents";
import { IMAGE_QUEUE_FULL_MESSAGE, imageQueueFull, newFileId, processImage, removeDocumentFiles, sanitizeMime, saveDocumentFile } from "@/lib/uploads";
import { acquireUploadSlot, BodyTooLargeError, declaredLength, readBodyLimited, UPLOAD_TOO_SLOW_MESSAGE, UploadTooSlowError } from "@/lib/upload-slots";
import { effectiveFileMaxMb, MULTIPART_OVERHEAD_BYTES } from "@/lib/upload-size";

export const runtime = "nodejs";

/** Sube un documento a la documentación del proyecto (campo "file" de un multipart/form-data). */
async function handlePost(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  const projectIdForLog = (await ctx.params).projectId;
  let release: (() => void) | null = null;
  let rateLimited = 0;
  let fileInfo: { name: string; type: string; size: number } | null = null;
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    const user = await requireUser();
    const { projectId } = await ctx.params;
    await assertProjectAccess(user, projectId);
    // Tope de subidas por persona (el mismo cubo y el mismo tope que los adjuntos de tareas): evita llenar disco o memoria con un bucle.
    if (!rateLimit(`upload:${user.id}`, 300, 60_000)) {
      rateLimited = rateLimitRetryAfterSec(`upload:${user.id}`);
      throw new AppError("Demasiadas peticiones", 429, "rate_limited");
    }
    // Sin Content-Length (algún proxy la quita) el tamaño se comprueba al leer el archivo.
    const length = declaredLength(req.headers);
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { fileMaxMb: true } });
    const fileMaxMb = effectiveFileMaxMb(project.fileMaxMb);
    const maxBytes = fileMaxMb * 1024 * 1024;
    const tooBig = async () => {
      const t = await getT();
      return new AppError(t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: fileMaxMb }), 413);
    };
    // Antes de leer el cuerpo: si la petición ya declara más que el archivo máximo (más el envoltorio multipart), se rechaza.
    if (length !== null && length > maxBytes + MULTIPART_OVERHEAD_BYTES) throw await tooBig();
    if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
    // Como mucho unas pocas subidas a la vez en todo el servidor (cada una se lee entera en memoria).
    release = await acquireUploadSlot();
    if (!release) throw new AppError("Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos.", 429, "upload_busy");
    // Con tope real al leer: sin Content-Length (o si miente un proxy intermedio) se corta al superar el máximo.
    const form = await readBodyLimited(req, maxBytes + MULTIPART_OVERHEAD_BYTES, "formData").catch(async (err) => {
      if (err instanceof UploadTooSlowError) throw new AppError(UPLOAD_TOO_SLOW_MESSAGE, 408);
      throw err instanceof BodyTooLargeError ? await tooBig() : err;
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("No se ha recibido ningún archivo.");
    fileInfo = { name: file.name, type: file.type, size: file.size };
    if (file.size > maxBytes) throw await tooBig();
    if (file.size === 0) throw new AppError("El archivo está vacío.");

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = sanitizeDocumentName(file.name);
    // El tipo sale de la extensión y se confirma con el contenido (cabecera de PDF, UTF-8 válido, sharp para imágenes).
    let kind: DocumentKindName = confirmDocumentKind(detectDocumentKind(name, file.type), buffer);
    let stored: Buffer = buffer;
    if (kind === "IMAGE") {
      const image = await processImage(buffer).catch((err) => {
        if (err instanceof AppError && err.status === 503) throw err; // cola llena: no se guarda como archivo normal
        return null;
      });
      if (image) stored = image.full;
      else kind = "OTHER"; // no es una imagen que sharp entienda: queda como descarga
    }
    const mimeType = documentMime(kind, sanitizeMime(file.type));
    // Primero el fichero y después la fila (ver newFileId): un corte entre medias deja como mucho un fichero sin fila, que
    // borra la limpieza de huérfanos; nunca un documento roto que además cuenta en la cuota.
    const id = newFileId();
    try {
      await saveDocumentFile(id, stored);
    } catch (err) {
      await removeDocumentFiles([id]);
      throw err;
    }
    const created = await createDocumentWithinLimit({ id, projectId, name, mimeType, size: stored.length, kind, createdById: user.id }).catch(async (err) => {
      await removeDocumentFiles([id]);
      throw err;
    });
    if (!created.ok) await removeDocumentFiles([id]);
    if (!created.ok) {
      const t = await getT();
      if (created.reason === "count") {
        throw new AppError(t("La documentación del proyecto ya tiene el máximo de {n} archivos.", { n: created.limit }), 413);
      }
      throw quotaError(t, created.quota, { projectId, isAdmin: user.role === "ADMIN" });
    }
    const document = created.document;
    logEvent({
      category: "api", action: "documents.upload", message: `Documento «${document.name}» subido (${Math.round(stored.length / 1024)} KB)`,
      userId: user.id, userName: user.name, path: `/api/projects/${projectId}/documents`, ip, durationMs: performance.now() - start,
      details: { projectId, documentId: document.id, original: fileInfo, storedBytes: stored.length, kind, mime: mimeType, sizeMb: roundMb(stored.length) },
    });
    publishChange({ projectId, userId: user.id, action: "documents.upload" });
    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    const user = await getCurrentUser().catch(() => null);
    logEvent({
      level: err instanceof AppError ? "warn" : "error", category: "api", action: "documents.uploadFailed",
      message: `Fallo al subir documento: ${err instanceof Error ? err.message : String(err)}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: `/api/projects/${projectIdForLog}/documents`, ip, durationMs: performance.now() - start,
      details: { projectId: projectIdForLog, file: fileInfo, status: err instanceof AppError ? err.status : 500 },
    });
    const t = await getT();
    if (err instanceof AppError) {
      const headers = err.code === "upload_busy" ? { "Retry-After": "5" } : err.code === "rate_limited" ? { "Retry-After": String(rateLimited || 60) } : undefined;
      return NextResponse.json({ error: t(err.message), ...(err.code ? { code: err.code } : {}) }, { status: err.status, headers });
    }
    console.error("[documents upload]", err);
    return NextResponse.json({ error: t("No se pudo procesar el archivo.") }, { status: 500 });
  } finally {
    release?.();
  }
}

/** La comprobación de acceso anota el proyecto en el contexto: así el log de la subida lo lleva. */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return actionContext.run({}, () => handlePost(req, ctx));
}
