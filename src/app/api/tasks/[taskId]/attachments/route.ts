import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertTaskAccess } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { actionContext } from "@/lib/action-context";
import { logEvent } from "@/lib/log";
import { publishChange } from "@/lib/realtime";
import { rateLimit } from "@/lib/rate-limit";
import { saveUndo } from "@/lib/undo";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser, requireUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { MAX_UPLOAD_BYTES, processImage, removeAttachmentFiles, sanitizeMime, saveAttachmentFiles, saveRawAttachmentFile } from "@/lib/uploads";
import type { AttachmentInfo } from "@/lib/types";

export const runtime = "nodejs";

/** Sube un archivo cualquiera (imagen → WebP + miniatura; otros tal cual) (campo "file" de un multipart/form-data) a una tarea. */
async function handlePost(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const start = performance.now();
  const ip = clientIp(req.headers);
  const taskIdForLog = (await ctx.params).taskId;
  let fileInfo: { name: string; type: string; size: number } | null = null;
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    const { projectId } = await assertTaskAccess(user, taskId);
    // Tope de subidas por persona: evita llenar el disco o la memoria (sharp) con un bucle.
    if (!rateLimit(`upload:${user.id}`, 60, 60_000)) throw new AppError("Demasiadas peticiones", 429);

    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("El archivo supera el tamaño máximo.", 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("No se ha recibido ningún archivo.");
    fileInfo = { name: file.name, type: file.type, size: file.size };
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("El archivo supera el tamaño máximo.", 413);
    if (file.size === 0) throw new AppError("El archivo está vacío.");

    const buffer = Buffer.from(await file.arrayBuffer());
    // Imágenes (salvo SVG, que puede llevar scripts): WebP + miniatura. Si sharp no puede
    // procesarla (p. ej. HEIC sin soporte), se guarda como un archivo cualquiera.
    let image: Awaited<ReturnType<typeof processImage>> | null = null;
    if (/^image\//i.test(file.type) && !/svg/i.test(file.type)) {
      image = await processImage(buffer).catch(() => null);
    }
    const originalName = (file.name || "captura").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "captura";
    const mimeType = image ? "image/webp" : sanitizeMime(file.type);
    const storedBytes = image ? image.full.length : buffer.length;
    const attachment = await db.taskAttachment.create({
      data: {
        taskId, originalName, mimeType, isImage: !!image, width: image?.width ?? null, height: image?.height ?? null,
        size: storedBytes, createdById: user.id,
      },
      select: { id: true, originalName: true, mimeType: true, isImage: true, width: true, height: true, size: true },
    });
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
      (await db.undoEntry.findFirst({ where: { userId: user.id, projectId }, orderBy: { createdAt: "desc" }, select: { taskId: true, ops: true } }).then(
        (last) => last?.taskId === taskId && JSON.stringify(last.ops).includes('"task.remove"'),
      ));
    publishChange({ projectId, userId: user.id, action: "attachments.upload" });
    if (!withCreation) {
      await saveUndo(user.id, projectId, `Subió «${attachment.originalName}»`, [{ t: "attachment.remove", id: attachment.id }], taskId).catch((err) =>
        console.error("[undo] no se pudo guardar", err),
      );
    }
    return NextResponse.json<AttachmentInfo>(attachment, { status: 201 });
  } catch (err) {
    const user = await getCurrentUser().catch(() => null);
    logEvent({
      level: err instanceof AppError ? "warn" : "error", category: "api", action: "attachments.uploadFailed",
      message: `Fallo al subir archivo: ${err instanceof Error ? err.message : String(err)}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: `/api/tasks/${taskIdForLog}/attachments`, ip, durationMs: performance.now() - start,
      details: { taskId: taskIdForLog, file: fileInfo, status: err instanceof AppError ? err.status : 500 },
    });
    const t = await getT();
    if (err instanceof AppError) return NextResponse.json({ error: t(err.message) }, { status: err.status });
    console.error("[upload]", err);
    return NextResponse.json({ error: t("No se pudo procesar el archivo.") }, { status: 500 });
  }
}

/** La comprobación de acceso anota el proyecto en el contexto: así el log de la subida lo lleva. */
export async function POST(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  return actionContext.run({}, () => handlePost(req, ctx));
}
