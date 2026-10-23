import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { visibleProjectsWhere } from "@/lib/access";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { attachmentPath, safeDownloadMime } from "@/lib/uploads";

export const runtime = "nodejs";

/** Sirve un adjunto (o su miniatura con ?thumb=1) solo a usuarios con acceso al proyecto. */
export async function GET(req: Request, ctx: { params: Promise<{ attachmentId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const { attachmentId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(attachmentId)) return new Response(t("No encontrado"), { status: 404 });

  const attachment = await db.taskAttachment.findFirst({
    where: { id: attachmentId, task: { project: visibleProjectsWhere(user) } },
    select: { id: true, originalName: true, taskId: true, isImage: true, mimeType: true, task: { select: { projectId: true } } },
  });
  if (!attachment) return new Response(t("No encontrado"), { status: 404 });

  const thumb = new URL(req.url).searchParams.has("thumb");
  const file = attachmentPath(attachment.id, !attachment.isImage ? "file" : thumb ? "thumb" : "full");
  let size: number;
  let mtimeMs: number;
  try {
    const st = await stat(file);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return new Response(t("Archivo no disponible"), { status: 404 });
  }
  // Los que no son imagen siempre se descargan (nunca inline: evita XSS almacenado con HTML/SVG/JS).
  const download = !attachment.isImage || new URL(req.url).searchParams.has("download");
  // Solo se registran las descargas explícitas; ver una imagen (en línea, miniatura o visor) no deja rastro.
  if (download) {
    logEvent({
      category: "api", action: "attachments.download", message: `Descarga de «${attachment.originalName}»`,
      userId: user.id, userName: user.name, projectId: attachment.task.projectId, path: new URL(req.url).pathname, ip: clientIp(req.headers), details: { attachmentId: attachment.id, taskId: attachment.taskId, size },
    });
  }
  // ETag fuerte a partir de la identidad del fichero guardado (id, variante, tamaño y fecha de modificación), sin leerlo.
  // Se responde 304 solo aquí, ya superada la comprobación de acceso.
  const variant = !attachment.isImage ? "file" : thumb ? "thumb" : "full";
  const etag = `"${attachment.id}-${variant}-${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    // Caché solo del navegador (nunca compartida). Las descargas se revalidan siempre para que queden registradas.
    "Cache-Control": download ? "private, no-cache" : "private, max-age=3600",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  if (ifNoneMatchHas(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  const filename = encodeURIComponent(attachment.isImage ? attachment.originalName.replace(/\.[^.]+$/, "") + ".webp" : attachment.originalName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": attachment.isImage ? "image/webp" : safeDownloadMime(attachment.mimeType),
      "Content-Length": String(size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
    },
  });
}

/** `If-None-Match` puede traer varios ETags (o `*`); la comparación débil basta para decidir el 304. */
function ifNoneMatchHas(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((x) => {
    const v = x.trim().replace(/^W\//, "");
    return v === "*" || v === etag;
  });
}
