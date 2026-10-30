import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findDocumentForUser } from "@/lib/documents";
import { documentDownloadName } from "@/lib/document-kind";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { documentPath } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Sirve un documento de la documentación del proyecto solo a quien tiene acceso al proyecto.
 * Nada se sirve nunca como HTML: texto y Markdown van como text/plain (el cliente los pinta), las imágenes ya son
 * WebP recodificado, el PDF se muestra con el visor del navegador y el resto siempre se descarga como octet-stream.
 */
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const { documentId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(documentId)) return new Response(t("No encontrado"), { status: 404 });

  const doc = await findDocumentForUser(user, documentId);
  if (!doc) return new Response(t("No encontrado"), { status: 404 });

  const file = documentPath(doc.id);
  let size: number;
  let mtimeMs: number;
  try {
    const st = await stat(file);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return new Response(t("Archivo no disponible"), { status: 404 });
  }
  const url = new URL(req.url);
  // Solo se vuelve a descargar lo explícito o lo que no tiene vista previa; ver un documento no deja rastro en el log.
  const download = doc.kind === "OTHER" || url.searchParams.has("download");
  if (download) {
    logEvent({
      category: "api", action: "documents.download", message: `Descarga de «${doc.name}»`,
      userId: user.id, userName: user.name, projectId: doc.projectId, path: url.pathname, ip: clientIp(req.headers), details: { documentId: doc.id, size },
    });
  }
  // ETag fuerte a partir de la identidad del fichero guardado, sin leerlo. El 304 solo llega tras la comprobación de acceso.
  const etag = `"${doc.id}-${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    // Siempre se revalida (el ETag evita reenviar el fichero): a quien pierda el acceso no le queda una copia en caché.
    "Cache-Control": "private, max-age=0, must-revalidate",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    // Se puede incrustar solo desde la propia app (el visor de PDF); nunca desde otro sitio.
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  // CSP del propio fichero: `sandbox` lo aísla del origen de la app (opaco, sin scripts) y `frame-ancestors` solo
  // deja incrustarlo desde la propia app. En el PDF no se añade `default-src 'none'`: bloquearía el visor del navegador.
  headers["Content-Security-Policy"] = doc.kind === "PDF" ? "sandbox; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; sandbox; frame-ancestors 'self'";
  if (!download && ifNoneMatchHas(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });

  const contentType =
    doc.kind === "TEXT" || doc.kind === "MARKDOWN" ? "text/plain; charset=utf-8"
    : doc.kind === "PDF" ? "application/pdf"
    : doc.kind === "IMAGE" ? "image/webp"
    : "application/octet-stream"; // OTHER: siempre descarga, sin fiarse del tipo que declaró quien lo subió
  const filename = encodeURIComponent(documentDownloadName(doc.name, doc.kind)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": contentType,
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
