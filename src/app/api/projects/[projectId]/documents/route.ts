import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertProjectAccess } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { actionContext } from "@/lib/action-context";
import { logEvent } from "@/lib/log";
import { publishChange } from "@/lib/realtime";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser, requireUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { roundMb } from "@/lib/attachment-limit";
import { confirmDocumentKind, detectDocumentKind, documentMime, sanitizeDocumentName, type DocumentKindName } from "@/lib/document-kind";
import { createDocumentWithinLimit } from "@/lib/documents";
import { IMAGE_QUEUE_FULL_MESSAGE, imageQueueFull, processImage, removeDocumentFiles, sanitizeMime, saveDocumentFile } from "@/lib/uploads";
import { effectiveFileMaxMb, MULTIPART_OVERHEAD_BYTES } from "@/lib/upload-size";

export const runtime = "nodejs";

/** Sube un documento a la documentación del proyecto (campo "file" de un multipart/form-data). */
async function handlePost(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  const projectIdForLog = (await ctx.params).projectId;
  let fileInfo: { name: string; type: string; size: number } | null = null;
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    const user = await requireUser();
    const { projectId } = await ctx.params;
    await assertProjectAccess(user, projectId);
    // Tope de subidas por persona (comparte cubo con los adjuntos de tareas): evita llenar disco o memoria con un bucle.
    if (!rateLimit(`upload:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas peticiones", 429);

    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { fileMaxMb: true } });
    const fileMaxMb = effectiveFileMaxMb(project.fileMaxMb);
    const maxBytes = fileMaxMb * 1024 * 1024;
    const tooBig = async () => {
      const t = await getT();
      return new AppError(t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: fileMaxMb }), 413);
    };
    // Antes de leer el cuerpo: si la petición ya declara más que el archivo máximo (más el envoltorio multipart), se rechaza.
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > maxBytes + MULTIPART_OVERHEAD_BYTES) throw await tooBig();
    if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
    const form = await req.formData();
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
    const created = await createDocumentWithinLimit({ projectId, name, mimeType, size: stored.length, kind, createdById: user.id });
    if (!created.ok) {
      const t = await getT();
      if (created.reason === "count") {
        throw new AppError(t("La documentación del proyecto ya tiene el máximo de {n} archivos.", { n: created.limit }), 413);
      }
      const vars = { used: created.quota.usedMb, limit: created.quota.limitMb };
      throw new AppError(
        created.quota.scope === "project"
          ? t("Cuota de adjuntos del proyecto superada: {used} MB usados de {limit} MB.", vars)
          : t("Cuota total de adjuntos del servidor superada: {used} MB usados de {limit} MB.", vars),
        413,
      );
    }
    const document = created.document;
    try {
      await saveDocumentFile(document.id, stored);
    } catch (err) {
      await db.projectDocument.deleteMany({ where: { id: document.id } });
      await removeDocumentFiles([document.id]);
      throw err;
    }
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
    if (err instanceof AppError) return NextResponse.json({ error: t(err.message), ...(err.code ? { code: err.code } : {}) }, { status: err.status });
    console.error("[documents upload]", err);
    return NextResponse.json({ error: t("No se pudo procesar el archivo.") }, { status: 500 });
  }
}

/** La comprobación de acceso anota el proyecto en el contexto: así el log de la subida lo lleva. */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return actionContext.run({}, () => handlePost(req, ctx));
}
