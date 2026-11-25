import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";
import { isRowId } from "@/lib/row-id";
import { SHARE_FILE_CSP, shareResponseHeaders } from "@/lib/share-out-core";
import { resolveShareToken, shareAttachment, shareDownloadAllowed, shareIpAllowed } from "@/lib/share-out";
import { attachmentPath, safeDownloadMime } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Adjuntos de la página de «Compartir fuera»: solo de una tarea publicada y viva de ESE enlace (si no, 404, igual que
// un adjunto que no existe). Se descargan siempre (`attachment`); las imágenes de la descripción, con `?inline=1`, se
// pueden ver en línea (con nosniff y una CSP con sandbox). Topes por IP y por enlace; las descargas quedan en Logs sin
// el token.

const fail = (status: number, text: string) => new Response(text, { status, headers: { ...shareResponseHeaders(), "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request, ctx: { params: Promise<{ token: string; attachmentId: string }> }) {
  const ip = clientIp(req.headers);
  if (!shareIpAllowed(ip)) return fail(429, "Too many requests");
  const { token, attachmentId } = await ctx.params;
  const resolved = await resolveShareToken(token);
  if (resolved?.kind !== "active" || !isRowId(attachmentId)) return fail(404, "Not found");
  const { share } = resolved;
  const meta = await shareAttachment(share, attachmentId);
  if (!meta) return fail(404, "Not found");
  const inline = meta.isImage && new URL(req.url).searchParams.has("inline");
  // Las descargas cuentan para el tope del enlace; ver las imágenes de la descripción no (ya cuentan por IP).
  if (!inline && !shareDownloadAllowed(share)) return fail(429, "Too many requests");
  const variant = meta.isImage ? "full" : "file";
  let size: number;
  try {
    size = (await stat(attachmentPath(meta.id, variant))).size;
  } catch {
    return fail(404, "Not found");
  }
  if (!inline) {
    logEvent({ category: "api", action: "shareOut.download", label: { k: "Descarga de «{name}» desde la web de «Compartir fuera»", p: { name: meta.originalName } }, projectId: share.projectId, path: "/x/…", ip, details: { attachmentId: meta.id, taskId: meta.taskId, shareId: share.id, size } });
  }
  const name = meta.isImage ? meta.originalName.replace(/\.[^.]+$/, "") + ".webp" : meta.originalName;
  const filename = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const stream = Readable.toWeb(createReadStream(attachmentPath(meta.id, variant))) as ReadableStream;
  return new Response(stream, {
    headers: {
      ...shareResponseHeaders(),
      "Content-Type": meta.isImage ? "image/webp" : safeDownloadMime(meta.mimeType),
      "Content-Length": String(size),
      [DECLARED_LENGTH_HEADER]: String(size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
      "Content-Security-Policy": SHARE_FILE_CSP,
    },
  });
}
