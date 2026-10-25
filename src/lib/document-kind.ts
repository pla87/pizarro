// Documentación del proyecto: tipos de fichero y nombres. Funciones puras (sin dependencias de servidor).

export type DocumentKindName = "TEXT" | "MARKDOWN" | "PDF" | "IMAGE" | "OTHER";

/** Máximo de documentos por proyecto. */
export const DOCUMENTS_MAX_PER_PROJECT = 200;
/** Máximo de bytes de un texto/Markdown que el visor descarga para mostrarlo (más grande: solo descarga). */
export const DOCUMENT_PREVIEW_MAX_BYTES = 1024 * 1024;

const TEXT_EXT = new Set(["txt", "text", "log", "csv", "tsv", "json", "yml", "yaml", "ini", "cfg", "conf", "toml", "xml", "env"]);
const MARKDOWN_EXT = new Set(["md", "markdown"]);
// SVG queda fuera a propósito: puede llevar scripts, así que es un fichero «otro» (solo descarga).
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/**
 * Tipo que *declara* el fichero (por extensión y, sin extensión, por el MIME del navegador).
 * El servidor lo confirma después con el contenido (confirmDocumentKind): esto solo es la primera impresión.
 */
export function detectDocumentKind(name: string, mime: string | null | undefined): DocumentKindName {
  const ext = extensionOf(name);
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  if (ext === "pdf") return "PDF";
  if (MARKDOWN_EXT.has(ext)) return "MARKDOWN";
  if (IMAGE_EXT.has(ext)) return "IMAGE";
  if (TEXT_EXT.has(ext)) return "TEXT";
  if (ext) return "OTHER";
  if (m === "application/pdf") return "PDF";
  if (m === "text/markdown" || m === "text/x-markdown") return "MARKDOWN";
  if (m === "text/plain" || m === "text/csv" || m === "application/json") return "TEXT";
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(m)) return "IMAGE";
  return "OTHER";
}

/** ¿Empieza como un PDF? (la cabecera «%PDF-» debe estar en el primer KB). */
export function looksLikePdf(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/** ¿Es texto UTF-8 válido y sin bytes nulos? (un binario con extensión .txt no se muestra como texto). */
export function looksLikeText(buf: Uint8Array): boolean {
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  const valid = (b: Uint8Array) => {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return true;
    } catch {
      return false;
    }
  };
  if (valid(sample)) return true;
  // Un carácter UTF-8 cortado justo en el límite de la muestra no es un fallo.
  return buf.length > sample.length && valid(sample.subarray(0, sample.length - 3));
}

/**
 * Tipo definitivo tras mirar el contenido: un PDF sin cabecera de PDF o un «texto» binario pasan a OTHER
 * (se sirven como octet-stream, sin vista previa). Las imágenes las confirma sharp en la subida.
 */
export function confirmDocumentKind(declared: DocumentKindName, content: Uint8Array): DocumentKindName {
  if (declared === "PDF") return looksLikePdf(content) ? "PDF" : "OTHER";
  if (declared === "TEXT" || declared === "MARKDOWN") return looksLikeText(content) ? declared : "OTHER";
  return declared;
}

/** Nombre apto para guardar y mostrar: sin rutas ni caracteres raros, sin punto inicial, 120 caracteres como mucho. */
export function sanitizeDocumentName(raw: string | null | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .slice(0, 120)
    .trim();
  return clean || "documento";
}

/** MIME guardado según el tipo confirmado (OTHER: el que declaró el cliente, ya normalizado). */
export function documentMime(kind: DocumentKindName, clientMime: string): string {
  switch (kind) {
    case "TEXT": return "text/plain";
    case "MARKDOWN": return "text/markdown";
    case "PDF": return "application/pdf";
    case "IMAGE": return "image/webp";
    default: return clientMime;
  }
}

/** Nombre de descarga: las imágenes se guardan como WebP, así que cambian de extensión. */
export function documentDownloadName(name: string, kind: DocumentKindName): string {
  return kind === "IMAGE" ? name.replace(/\.[^.]+$/, "") + ".webp" : name;
}

/** ¿Se puede ver en el visor? (el resto: solo descarga). */
export const isPreviewable = (kind: DocumentKindName): boolean => kind !== "OTHER";
