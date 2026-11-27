import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";
import { isRowId } from "@/lib/row-id";
import { SHARE_FILE_CSP, shareResponseHeaders } from "@/lib/share-out-core";
import { resolveShareToken, shareAttachment, shareAuthorName, shareDownloadAllowed, shareIpAllowed } from "@/lib/share-out";
import { attachmentPath, safeDownloadMime } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Adjuntos de la página de «Compartir fuera»: solo de una tarea publicada y viva de ESE enlace (si no, 404, igual que
// un adjunto que no existe). Se descargan siempre (`attachment`); las imágenes (las de la descripción y las miniaturas de los
// adjuntos, con `?inline=thumb`, que usa la miniatura y se guarda una hora en el navegador), con `?inline=1`, se pueden ver en línea (con nosniff y una CSP con sandbox). Topes por IP y por enlace; las descargas quedan en Logs sin
// el token. HEAD propio (ver abajo).

const fail = (status: number, text: string) => new Response(text, { status, headers: { ...shareResponseHeaders(), "Content-Type": "text/plain; charset=utf-8" } });

type Ctx = { params: Promise<{ token: string; attachmentId: string }> };

export function GET(req: Request, ctx: Ctx) {
  return serve(req, ctx, false);
}

/**
 * HEAD: las mismas comprobaciones y cabeceras que GET, solo con `stat`: sin abrir el fichero (derivado de GET, Next abría
 * el flujo, descartaba el cuerpo y el descriptor no se cerraba nunca), sin gastar el cupo de descargas y sin registrar.
 */
export function HEAD(req: Request, ctx: Ctx) {
  return serve(req, ctx, true);
}

async function serve(req: Request, ctx: Ctx, head: boolean): Promise<Response> {
  const ip = clientIp(req.headers);
  if (!shareIpAllowed(ip)) return fail(429, "Too many requests");
  const { token, attachmentId } = await ctx.params;
  const resolved = await resolveShareToken(token);
  if (resolved?.kind !== "active" || !isRowId(attachmentId)) return fail(404, "Not found");
  const { share } = resolved;
  const meta = await shareAttachment(share, attachmentId);
  if (!meta) return fail(404, "Not found");
  const inlineParam = new URL(req.url).searchParams.get("inline");
  const inline = meta.isImage && inlineParam !== null;
  const thumbWanted = inline && inlineParam === "thumb";
  // Las descargas cuentan para el tope del enlace; ver las imágenes de la descripción no (ya cuentan por IP).
  if (!inline && !head && !shareDownloadAllowed(share)) return fail(429, "Too many requests");
  let variant: "full" | "thumb" | "file" = meta.isImage ? "full" : "file";
  let size: number | undefined;
  // La miniatura, si existe; si no (imágenes antiguas o sin miniatura), la normal.
  if (thumbWanted) {
    try {
      size = (await stat(attachmentPath(meta.id, "thumb"))).size;
      variant = "thumb";
    } catch {
      size = undefined;
    }
  }
  if (size === undefined) {
    try {
      size = (await stat(attachmentPath(meta.id, variant))).size;
    } catch {
      return fail(404, "Not found");
    }
  }
  if (!inline && !head) {
    logEvent({ category: "api", action: "shareOut.download", label: { k: "Descarga de «{name}» desde la web de «Compartir fuera»", p: { name: meta.originalName } }, userName: await shareAuthorName(share), projectId: share.projectId, path: "/x/…", ip, details: { attachmentId: meta.id, taskId: meta.taskId, shareId: share.id, size } });
  }
  const name = meta.isImage ? meta.originalName.replace(/\.[^.]+$/, "") + ".webp" : meta.originalName;
  const filename = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers = {
    ...shareResponseHeaders(),
    // Solo la miniatura se guarda en el navegador (una hora, sin compartirla): el resto, nunca.
    ...(variant === "thumb" ? { "Cache-Control": "private, max-age=3600" } : {}),
    "Content-Type": meta.isImage ? "image/webp" : safeDownloadMime(meta.mimeType),
    "Content-Length": String(size),
    [DECLARED_LENGTH_HEADER]: String(size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
    "Content-Security-Policy": SHARE_FILE_CSP,
  };
  if (head) return new Response(null, { headers });
  const stream = Readable.toWeb(createReadStream(attachmentPath(meta.id, variant))) as ReadableStream;
  return new Response(stream, { headers });
}
