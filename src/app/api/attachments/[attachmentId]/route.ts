import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { visibleProjectsWhere } from "@/lib/access";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { attachmentPath, safeDownloadMime } from "@/lib/uploads";

export const runtime = "nodejs";

/** Sirve un adjunto (o su miniatura con ?thumb=1) solo a usuarios con acceso al proyecto. */
export async function GET(req: Request, ctx: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const { attachmentId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(attachmentId)) return new Response("No encontrado", { status: 404 });

  const attachment = await db.taskAttachment.findFirst({
    where: { id: attachmentId, task: { project: visibleProjectsWhere(user) } },
    select: { id: true, originalName: true, taskId: true, isImage: true, mimeType: true, task: { select: { projectId: true } } },
  });
  if (!attachment) return new Response("No encontrado", { status: 404 });

  const thumb = new URL(req.url).searchParams.has("thumb");
  const file = attachmentPath(attachment.id, !attachment.isImage ? "file" : thumb ? "thumb" : "full");
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("Archivo no disponible", { status: 404 });
  }
  // Los que no son imagen siempre se descargan (nunca inline: evita XSS almacenado con HTML/SVG/JS).
  const download = !attachment.isImage || new URL(req.url).searchParams.has("download");
  // Las miniaturas son demasiadas: solo se registran las imágenes completas.
  if (!thumb) {
    logEvent({
      category: "api", action: download ? "attachments.download" : "attachments.view", message: `${download ? "Descarga" : "Vista"} de «${attachment.originalName}»`,
      userId: user.id, userName: user.name, projectId: attachment.task.projectId, path: new URL(req.url).pathname, ip: clientIp(req.headers), details: { attachmentId: attachment.id, taskId: attachment.taskId, size },
    });
  }
  const filename = encodeURIComponent(attachment.isImage ? attachment.originalName.replace(/\.[^.]+$/, "") + ".webp" : attachment.originalName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": attachment.isImage ? "image/webp" : safeDownloadMime(attachment.mimeType),
      "Content-Length": String(size),
      // Los ids son únicos e inmutables: caché privada larga.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
