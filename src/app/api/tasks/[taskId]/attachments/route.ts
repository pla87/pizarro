import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertTaskAccess } from "@/lib/access";
import { AppError } from "@/lib/errors";
import { isSameOrigin } from "@/lib/request";
import { requireUser } from "@/lib/session";
import { MAX_UPLOAD_BYTES, processImage, removeAttachmentFiles, saveAttachmentFiles } from "@/lib/uploads";
import type { AttachmentInfo } from "@/lib/types";

export const runtime = "nodejs";

/** Sube una imagen (campo "file" de un multipart/form-data) a una tarea. */
export async function POST(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    const user = await requireUser();
    const { taskId } = await ctx.params;
    await assertTaskAccess(user, taskId);

    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("La imagen supera el tamaño máximo.", 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("No se ha recibido ninguna imagen.");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("La imagen supera el tamaño máximo.", 413);

    const image = await processImage(Buffer.from(await file.arrayBuffer()));
    const originalName = (file.name || "captura").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "captura";
    const attachment = await db.taskAttachment.create({
      data: { taskId, originalName, width: image.width, height: image.height, size: image.full.length, createdById: user.id },
      select: { id: true, originalName: true, width: true, height: true },
    });
    try {
      await saveAttachmentFiles(attachment.id, image);
    } catch (err) {
      await db.taskAttachment.delete({ where: { id: attachment.id } });
      await removeAttachmentFiles([attachment.id]);
      throw err;
    }
    return NextResponse.json<AttachmentInfo>(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[upload]", err);
    return NextResponse.json({ error: "No se pudo procesar la imagen." }, { status: 500 });
  }
}
