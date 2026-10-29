import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertNotArchivedRow, loadTaskWithAccess } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { actionContext } from "@/lib/action-context";
import { logEvent } from "@/lib/log";
import { publishChange } from "@/lib/realtime";
import { rateLimit } from "@/lib/rate-limit";
import { saveUndo } from "@/lib/undo";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser, requireUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { createAttachmentWithinLimit, roundMb } from "@/lib/attachment-limit";
import { IMAGE_QUEUE_FULL_MESSAGE, imageQueueFull, processImage, removeAttachmentFiles, sanitizeMime, saveAttachmentFiles, saveRawAttachmentFile } from "@/lib/uploads";
import { attachmentTotals } from "@/lib/board";
import { acquireUploadSlot, declaredLength } from "@/lib/upload-slots";
import { effectiveFileMaxMb, MULTIPART_OVERHEAD_BYTES } from "@/lib/upload-size";
import type { UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

/** Sube un archivo cualquiera (imagen → WebP + miniatura; otros tal cual) (campo "file" de un multipart/form-data) a una tarea. */
async function handlePost(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  const taskIdForLog = (await ctx.params).taskId;
  let release: (() => void) | null = null;
  let fileInfo: { name: string; type: string; size: number } | null = null;
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const task = await loadTaskWithAccess(user, taskId, { archivedAt: true, project: { select: { fileMaxMb: true } } });
    assertNotArchivedRow(task);
    const { projectId } = task;
    // Tope de subidas por persona: evita llenar el disco o la memoria (sharp) con un bucle.
    if (!rateLimit(`upload:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas peticiones", 429);
    // Sin Content-Length no se puede comprobar el tamaño antes de leer el cuerpo.
    const length = declaredLength(req.headers);
    if (length === null) throw new AppError("Falta la cabecera Content-Length.", 411);
    // Como mucho unas pocas subidas a la vez en todo el servidor (cada una se lee entera en memoria).
    release = acquireUploadSlot();
    if (!release) throw new AppError("Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos.", 429, "upload_busy");

    // Límite de un archivo: el del proyecto (y, si existe, el tope MAX_UPLOAD_MB del servidor), leído en cada subida.
    const fileMaxMb = effectiveFileMaxMb(task.project.fileMaxMb);
    const maxBytes = fileMaxMb * 1024 * 1024;
    const tooBig = async () => {
      const t = await getT();
      return new AppError(t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: fileMaxMb }), 413);
    };
    // Antes de leer el cuerpo: si la petición ya declara más que el archivo máximo (más el envoltorio multipart), se rechaza.
    if (length > maxBytes + MULTIPART_OVERHEAD_BYTES) throw await tooBig();
    // Cola de imágenes llena: se rechaza antes de leer el cuerpo (no se sabe si es imagen, pero el servidor está saturado).
    if (imageQueueFull()) throw new AppError(IMAGE_QUEUE_FULL_MESSAGE, 503);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("No se ha recibido ningún archivo.");
    fileInfo = { name: file.name, type: file.type, size: file.size };
    if (file.size > maxBytes) throw await tooBig();
    if (file.size === 0) throw new AppError("El archivo está vacío.");

    const buffer = Buffer.from(await file.arrayBuffer());
    // Imágenes (salvo SVG, que puede llevar scripts): WebP + miniatura. Si sharp no puede
    // procesarla (p. ej. HEIC sin soporte), se guarda como un archivo cualquiera.
    let image: Awaited<ReturnType<typeof processImage>> | null = null;
    if (/^image\//i.test(file.type) && !/svg/i.test(file.type)) {
      image = await processImage(buffer).catch((err) => {
        if (err instanceof AppError && err.status === 503) throw err; // cola llena: no se guarda como archivo normal
        return null;
      });
    }
    const originalName = (file.name || "captura").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "captura";
    const mimeType = image ? "image/webp" : sanitizeMime(file.type);
    const storedBytes = image ? image.full.length : buffer.length;
    // Tope del proyecto para la suma de adjuntos de la tarea y cuotas de almacenamiento (por proyecto y, si está
    // configurada, total): sumas y alta atómicas. Si no cabe, se rechaza con el uso actual.
    const created = await createAttachmentWithinLimit(
      { taskId, originalName, mimeType, isImage: !!image, width: image?.width ?? null, height: image?.height ?? null, size: storedBytes, createdById: user.id },
      { id: true, originalName: true, mimeType: true, isImage: true, width: true, height: true, size: true },
    );
    if (!created.ok && created.reason === "quota") {
      const t = await getT();
      const vars = { used: created.quota.usedMb, limit: created.quota.limitMb };
      throw new AppError(
        created.quota.scope === "project"
          ? t("Cuota de adjuntos del proyecto superada: {used} MB usados de {limit} MB.", vars)
          : t("Cuota total de adjuntos del servidor superada: {used} MB usados de {limit} MB.", vars),
        413,
      );
    }
    if (!created.ok) {
      const t = await getT();
      throw new AppError(
        t("Los adjuntos de la tarea superarían el máximo del proyecto ({limit} MB por tarea; ya tiene {used} MB). Puedes cambiarlo en los ajustes del proyecto.", {
          limit: created.limitMb, used: roundMb(created.usedBytes),
        }),
        413,
        "task_total",
      );
    }
    const attachment = created.attachment;
    try {
      if (image) await saveAttachmentFiles(attachment.id, image);
      else await saveRawAttachmentFile(attachment.id, buffer);
    } catch (err) {
      await db.taskAttachment.delete({ where: { id: attachment.id } });
      await removeAttachmentFiles([attachment.id]);
      throw err;
    }
    logEvent({
      category: "api", action: "attachments.upload", message: `${image ? "Imagen" : "Archivo"} «${attachment.originalName}» subido (${Math.round(storedBytes / 1024)} KB)`,
      userId: user.id, userName: user.name, path: `/api/tasks/${taskId}/attachments`, ip, durationMs: performance.now() - start,
      details: {
        taskId, attachmentId: attachment.id, original: fileInfo, storedBytes, mime: mimeType, isImage: !!image,
        width: image?.width ?? null, height: image?.height ?? null,
      },
    });
    // Deshacer la subida borra el adjunto. Con ?alCrear=1 (adjuntos de «Nueva tarea»), si lo último del
    // usuario es crear esta tarea, la subida va con esa acción: deshacer la creación ya se lleva el adjunto.
    const withCreation =
      new URL(req.url).searchParams.get("alCrear") === "1" &&
      (await db.undoEntry.findFirst({ where: { userId: user.id, projectId, kind: "UNDO" }, orderBy: { createdAt: "desc" }, select: { taskId: true, ops: true } }).then(
        (last) => last?.taskId === taskId && JSON.stringify(last.ops).includes('"task.remove"'),
      ));
    publishChange({ projectId, userId: user.id, action: "attachments.upload" });
    if (!withCreation) {
      await saveUndo(user.id, projectId, `Subió «${attachment.originalName}»`, [{ t: "attachment.remove", id: attachment.id }], taskId).catch((err) =>
        console.error("[undo] no se pudo guardar", err),
      );
    }
    // Contadores reales de la tarea (solo filas existentes): el cliente los aplica tal cual, sin sumar a ciegas.
    return NextResponse.json<UploadedAttachment>({ ...attachment, totals: await attachmentTotals(taskId) }, { status: 201 });
  } catch (err) {
    const user = await getCurrentUser().catch(() => null);
    logEvent({
      level: err instanceof AppError ? "warn" : "error", category: "api", action: "attachments.uploadFailed",
      message: `Fallo al subir archivo: ${err instanceof Error ? err.message : String(err)}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: `/api/tasks/${taskIdForLog}/attachments`, ip, durationMs: performance.now() - start,
      details: { taskId: taskIdForLog, file: fileInfo, status: err instanceof AppError ? err.status : 500 },
    });
    const t = await getT();
    if (err instanceof AppError) {
      const headers = err.code === "upload_busy" ? { "Retry-After": "5" } : undefined;
      return NextResponse.json({ error: t(err.message), ...(err.code ? { code: err.code } : {}) }, { status: err.status, headers });
    }
    console.error("[upload]", err);
    return NextResponse.json({ error: t("No se pudo procesar el archivo.") }, { status: 500 });
  } finally {
    release?.();
  }
}

/** La comprobación de acceso anota el proyecto en el contexto: así el log de la subida lo lleva. */
export async function POST(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  return actionContext.run({}, () => handlePost(req, ctx));
}
