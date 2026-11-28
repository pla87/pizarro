import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findDocumentForUser, isNoteDocument, readNoteBody } from "@/lib/documents";
import { documentDownloadName } from "@/lib/document-kind";
import { ifNoneMatchHas } from "@/lib/etag";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { documentPath } from "@/lib/uploads";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";

export const runtime = "nodejs";

/**
 * Sirve un documento de la documentación del proyecto solo a quien tiene acceso al proyecto.
 * Nada se sirve nunca como HTML: texto, Markdown y HTML van como text/plain (el cliente los pinta; el HTML, en un marco
 * aislado sin scripts), las imágenes ya son WebP recodificado, el PDF se muestra con el visor del navegador y el resto
 * siempre se descarga como octet-stream. Descargado, el HTML también va como octet-stream (y como adjunto).
 */
export function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  return serve(req, ctx, false);
}

/**
 * HEAD: las mismas cabeceras que GET sin abrir el fichero ni registrar una descarga (derivado de GET, Next abría el
 * flujo del fichero y el descriptor no se cerraba nunca).
 */
export function HEAD(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  return serve(req, ctx, true);
}

async function serve(req: Request, ctx: { params: Promise<{ documentId: string }> }, head: boolean): Promise<Response> {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const { documentId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(documentId)) return new Response(t("No encontrado"), { status: 404 });

  // Sin el texto de la nota: el ETag solo necesita su tamaño y su versión; el texto se lee al servir el cuerpo.
  const doc = await findDocumentForUser(user, documentId);
  if (!doc) return new Response(t("No encontrado"), { status: 404 });
  // Pedido por un <img> (una imagen de Documentación en una nota, una descripción o un comentario): solo se sirven las
  // imágenes, y nunca cuenta como descarga. Un `![x](/api/documents/<id de un .zip>)` registraba una «descarga» a nombre
  // de cada persona que abría la tarea. Sec-Fetch-Dest lo pone el navegador y una página no lo puede falsear.
  const asImage = req.headers.get("sec-fetch-dest") === "image";
  if (asImage && doc.kind !== "IMAGE") return new Response(t("No encontrado"), { status: 404 });

  // Una nota (escrita en la app) no tiene fichero: se sirve su texto, como un .md, con la versión en el ETag. `size` ya
  // son los bytes de su texto (se guarda con él), así que HEAD y el 304 no leen el texto.
  const isNote = await isNoteDocument(doc.id);
  const file = documentPath(doc.id);
  let size: number;
  let stamp: string;
  if (isNote) {
    size = doc.size;
    stamp = `n${doc.noteVersion.toString(36)}`;
  } else {
    try {
      const st = await stat(file);
      size = st.size;
      stamp = Math.floor(st.mtimeMs).toString(36);
    } catch {
      return new Response(t("Archivo no disponible"), { status: 404 });
    }
  }
  const url = new URL(req.url);
  // Solo se vuelve a descargar lo explícito o lo que no tiene vista previa; ver un documento no deja rastro en el log.
  const download = !asImage && (doc.kind === "OTHER" || url.searchParams.has("download"));
  if (download && !head) {
    logEvent({
      category: "api", action: "documents.download", label: { k: "Descarga de «{name}»", p: { name: doc.name } },
      userId: user.id, userName: user.name, projectId: doc.projectId, path: url.pathname, ip: clientIp(req.headers), details: { documentId: doc.id, size },
    });
  }
  // ETag fuerte a partir de la identidad del fichero guardado (o de la versión de la nota), sin leerlo. El 304 solo llega tras la comprobación de acceso.
  const etag = `"${doc.id}-${size.toString(36)}-${stamp}"`;
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
    doc.kind === "HTML" ? (download ? "application/octet-stream" : "text/plain; charset=utf-8")
    : doc.kind === "TEXT" || doc.kind === "MARKDOWN" ? "text/plain; charset=utf-8"
    : doc.kind === "PDF" ? "application/pdf"
    : doc.kind === "IMAGE" ? "image/webp"
    : "application/octet-stream"; // OTHER: siempre descarga, sin fiarse del tipo que declaró quien lo subió
  const filename = encodeURIComponent(documentDownloadName(doc.name, doc.kind)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const fullHeaders = {
    ...headers,
    "Content-Type": contentType,
    "Content-Length": String(size),
    // Next quita el Content-Length al copiar la respuesta: el gancho de response-length.ts lo repone.
    [DECLARED_LENGTH_HEADER]: String(size),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
  };
  if (head) return new Response(null, { headers: fullHeaders });
  if (isNote) {
    // El texto se lee solo ahora. Si cambió desde la comprobación de arriba, el cuerpo, su tamaño y su ETag son los de lo leído.
    const body = await readNoteBody(doc.id);
    if (!body) return new Response(t("No encontrado"), { status: 404 });
    const bytes = Buffer.from(body.content, "utf8");
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...fullHeaders,
        ETag: `"${doc.id}-${bytes.length.toString(36)}-n${body.version.toString(36)}"`,
        "Content-Length": String(bytes.length),
        [DECLARED_LENGTH_HEADER]: String(bytes.length),
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: fullHeaders });
}
