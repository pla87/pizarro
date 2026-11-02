import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { canAccessProject } from "@/lib/access-cache";
import type { Variant } from "@/lib/attachment-cache";
import { attachmentFileStat, getAttachmentMeta } from "@/lib/attachment-lookup";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { attachmentPath, safeDownloadMime } from "@/lib/uploads";

export const runtime = "nodejs";

/** Las respuestas de error son raras: solo ellas necesitan traducción (getT lee cookies y preferencias). */
async function fail(status: number, text: (t: Awaited<ReturnType<typeof getT>>) => string): Promise<Response> {
  return new Response(text(await getT()), { status });
}

/**
 * Sirve un adjunto (o su miniatura con ?thumb=1) solo a usuarios con acceso al proyecto.
 * Camino caliente (el 304 de cada miniatura del tablero): sesión + acceso en caché (access-cache.ts, la misma que
 * revoke.ts vacía al quitar el acceso) + metadatos del adjunto en caché de 5 s (attachment-cache.ts). El permiso se
 * comprueba siempre en cada petición; lo que se guarda en memoria es solo «a qué proyecto pertenece este adjunto».
 */
export async function GET(req: Request, ctx: { params: Promise<{ attachmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail(401, (t) => t("No autorizado"));
  const { attachmentId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(attachmentId)) return fail(404, (t) => t("No encontrado"));

  const attachment = await getAttachmentMeta(attachmentId);
  // Misma respuesta (404) si no existe o si no se tiene acceso: no se revela cuál de las dos.
  if (!attachment || !(await canAccessProject(user, attachment.projectId))) return fail(404, (t) => t("No encontrado"));

  const url = new URL(req.url);
  const thumb = url.searchParams.has("thumb");
  const variant: Variant = !attachment.isImage ? "file" : thumb ? "thumb" : "full";
  // Los que no son imagen siempre se descargan (nunca inline: evita XSS almacenado con HTML/SVG/JS).
  const download = !attachment.isImage || url.searchParams.has("download");
  // Para el 304 basta el tamaño y la fecha en caché; para enviar el cuerpo se lee del disco (si el fichero ya no está, 404).
  let size: number;
  let mtimeMs: number;
  try {
    ({ size, mtimeMs } = await attachmentFileStat(attachment, variant, false));
  } catch {
    return fail(404, (t) => t("Archivo no disponible"));
  }
  let etag = makeEtag(attachment.id, variant, size, mtimeMs);
  // Solo se registran las descargas explícitas (también si el navegador revalida con 304); ver una imagen
  // (en línea, miniatura o visor) no deja rastro.
  const logDownload = () => {
    if (!download) return;
    logEvent({
      category: "api", action: "attachments.download", message: `Descarga de «${attachment.originalName}»`,
      userId: user.id, userName: user.name, projectId: attachment.projectId, path: url.pathname, ip: clientIp(req.headers), details: { attachmentId: attachment.id, taskId: attachment.taskId, size },
    });
  };
  const headers: Record<string, string> = {
    ETag: etag,
    // Caché solo del navegador (nunca compartida). Las imágenes en línea se reutilizan 10 s sin preguntar al servidor
    // (después se revalidan con ETag: 304 sin cuerpo; si se quita el acceso, deja de verse en unos segundos). Las
    // descargas explícitas y los ficheros no imagen se revalidan siempre, para que queden registradas.
    "Cache-Control": download ? "private, no-cache" : "private, max-age=10",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatchHas(ifNoneMatch, etag)) {
    logDownload();
    return new Response(null, { status: 304, headers });
  }
  // Se va a enviar el cuerpo: se confirma con el disco (la caché pudo quedarse atrás unos segundos).
  try {
    ({ size, mtimeMs } = await attachmentFileStat(attachment, variant, true));
  } catch {
    return fail(404, (t) => t("Archivo no disponible"));
  }
  etag = makeEtag(attachment.id, variant, size, mtimeMs);
  headers.ETag = etag;
  logDownload();
  const filename = encodeURIComponent(attachment.isImage ? attachment.originalName.replace(/\.[^.]+$/, "") + ".webp" : attachment.originalName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const stream = Readable.toWeb(createReadStream(attachmentPath(attachment.id, variant))) as ReadableStream;
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": attachment.isImage ? "image/webp" : safeDownloadMime(attachment.mimeType),
      "Content-Length": String(size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
    },
  });
}

/** ETag fuerte a partir de la identidad del fichero guardado (id, variante, tamaño y fecha de modificación), sin leerlo. */
function makeEtag(id: string, variant: Variant, size: number, mtimeMs: number): string {
  return `"${id}-${variant}-${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
}

/** `If-None-Match` puede traer varios ETags (o `*`); la comparación débil basta para decidir el 304. */
function ifNoneMatchHas(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((x) => {
    const v = x.trim().replace(/^W\//, "");
    return v === "*" || v === etag;
  });
}
