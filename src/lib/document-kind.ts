// Documentación del proyecto: tipos de fichero y nombres. Funciones puras (sin dependencias de servidor).
import { cleanFileName } from "./file-name";

export type DocumentKindName = "TEXT" | "MARKDOWN" | "PDF" | "IMAGE" | "HTML" | "OTHER";

/** Máximo de documentos por proyecto. */
export const DOCUMENTS_MAX_PER_PROJECT = 200;
/** Días que un documento borrado se conserva en la papelera antes de purgarse (fila y fichero). */
export const DOCUMENT_TRASH_DAYS = 7;
/** Máximo de bytes de un texto/Markdown/HTML que el visor descarga para mostrarlo (más grande: solo descarga). */
export const DOCUMENT_PREVIEW_MAX_BYTES = 1024 * 1024;

const TEXT_EXT = new Set(["txt", "text", "log", "csv", "tsv", "json", "yml", "yaml", "ini", "cfg", "conf", "toml", "xml", "env"]);
const MARKDOWN_EXT = new Set(["md", "markdown"]);
// SVG queda fuera a propósito: puede llevar scripts, así que es un fichero «otro» (solo descarga).
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
// HTML: el servidor lo sirve siempre como texto plano (o como descarga); el visor lo pinta en un marco aislado, sin scripts
// ni red (ver HtmlPreview). Nunca como página del origen de la app.
const HTML_EXT = new Set(["html", "htm"]);

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
  if (HTML_EXT.has(ext)) return "HTML";
  if (ext) return "OTHER";
  if (m === "application/pdf") return "PDF";
  if (m === "text/markdown" || m === "text/x-markdown") return "MARKDOWN";
  if (m === "text/plain" || m === "text/csv" || m === "application/json") return "TEXT";
  if (m === "text/html") return "HTML";
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(m)) return "IMAGE";
  return "OTHER";
}

/** ¿Empieza como un PDF? (la cabecera «%PDF-» debe estar en el primer KB). */
export function looksLikePdf(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/** BOM de UTF-16 (LE: FF FE, BE: FE FF), UTF-8 (EF BB BF) o ninguno. */
function bomOf(buf: Uint8Array): "utf-16le" | "utf-16be" | "utf-8" | null {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf-16le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf-16be";
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf-8";
  return null;
}

function validUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Texto sin caracteres de control raros (salvo tabulador, saltos de línea y de página). */
function plainText(s: string): boolean {
  return !/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(s);
}

/**
 * ¿Es texto? Vale UTF-8 válido, UTF-16 con BOM (los bytes nulos son normales ahí) y, si no es UTF-8, el texto de una sola
 * codificación de 8 bits (Latin-1 / Windows-1252): sin bytes nulos y con muy pocos controles (un binario con extensión
 * .txt no lo pasa).
 */
export function looksLikeText(buf: Uint8Array): boolean {
  const sample = buf.subarray(0, 64 * 1024);
  const bom = bomOf(sample);
  if (bom === "utf-16le" || bom === "utf-16be") {
    // La muestra se corta en un par de bytes y, tras decodificar, no debe haber controles.
    const even = sample.subarray(0, sample.length - (sample.length % 2));
    return plainText(new TextDecoder(bom).decode(even));
  }
  if (sample.includes(0)) return false;
  if (validUtf8(sample)) return true;
  // Un carácter UTF-8 cortado justo en el límite de la muestra no es un fallo.
  if (buf.length > sample.length && validUtf8(sample.subarray(0, sample.length - 3))) return true;
  // Windows-1252: los controles (y los 5 bytes sin asignar: 81, 8D, 8F, 90, 9D) no pueden pasar del 1 %.
  let odd = 0;
  for (const b of sample) {
    if ((b < 0x20 && b !== 9 && b !== 10 && b !== 12 && b !== 13) || b === 0x7f || b === 0x81 || b === 0x8d || b === 0x8f || b === 0x90 || b === 0x9d) odd++;
  }
  return odd * 100 <= sample.length;
}

/** Codificación declarada en `<meta charset>` o `<meta http-equiv="content-type">` en el primer KB (o null). */
function declaredCharset(buf: Uint8Array): string | null {
  const head = new TextDecoder("windows-1252").decode(buf.subarray(0, 1024));
  const m = /<meta\s[^>]*?charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(head);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Texto de un documento de Documentación para mostrarlo (el fichero guardado no se toca; la descarga lo entrega tal cual).
 * Orden: BOM (UTF-8, UTF-16 LE/BE); en HTML, la codificación declarada en los primeros bytes (menos UTF-16, que sin BOM no
 * puede ser, y las que el navegador no conoce); UTF-8 si es válido; y si no, Windows-1252 (que incluye Latin-1). Nunca
 * lanza. El saneado del HTML se aplica después, sobre el texto ya decodificado.
 */
export function decodeDocumentText(buf: Uint8Array, kind: DocumentKindName = "TEXT"): string {
  const bom = bomOf(buf);
  if (bom) return new TextDecoder(bom).decode(buf).replace(/^﻿/, "");
  if (kind === "HTML") {
    const label = declaredCharset(buf);
    if (label) {
      try {
        // Se mira la codificación a la que lleva la etiqueta, no su nombre: «unicode», «ucs-2» o «csunicode» son UTF-16
        // (que sin BOM no puede ser: el navegador lo toma como UTF-8) y «unicode-1-1-utf-8» es UTF-8 (lo decide el paso
        // siguiente, que cae a Windows-1252 si no es válido).
        const dec = new TextDecoder(label);
        if (dec.encoding !== "replacement" && dec.encoding !== "utf-8" && !dec.encoding.startsWith("utf-16")) return dec.decode(buf);
      } catch { /* etiqueta desconocida: se sigue */ }
    }
  }
  if (validUtf8(buf)) return new TextDecoder("utf-8").decode(buf);
  return new TextDecoder("windows-1252").decode(buf);
}

/**
 * Tipo definitivo tras mirar el contenido: un PDF sin cabecera de PDF o un «texto» (o HTML) binario pasan a OTHER
 * (se sirven como octet-stream, sin vista previa). Las imágenes las confirma sharp en la subida.
 */
export function confirmDocumentKind(declared: DocumentKindName, content: Uint8Array): DocumentKindName {
  if (declared === "PDF") return looksLikePdf(content) ? "PDF" : "OTHER";
  if (declared === "TEXT" || declared === "MARKDOWN" || declared === "HTML") return looksLikeText(content) ? declared : "OTHER";
  return declared;
}

/** Ruta absoluta (la que algún navegador antiguo manda como nombre: «C:\fakepath\nota.txt», «\\servidor\…», «/home/…»). */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/**
 * Nombre apto para guardar y mostrar: sin punto inicial, sin los caracteres que no admite un nombre de archivo ni
 * controles (ver cleanFileName: paréntesis, comas, &, +, #… se conservan; «\» y «/» pasan a «_», como en los adjuntos)
 * y con 120 caracteres como mucho, recortando el nombre y no la extensión (de ella depende el tipo de documento). Solo
 * de una ruta absoluta se toma el último tramo: un nombre normal con «\» («Informe 1\2») no pierde lo anterior.
 */
export function sanitizeDocumentName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  // Los «../» o «./» del principio (ruta relativa) se quitan; el resto de barras pasan a «_».
  const base = ABSOLUTE_PATH.test(text) ? (text.split(/[\\/]/).pop() ?? "") : text.replace(/^(?:\.{1,2}[\\/])+/, "");
  return cleanFileName(base, "").replace(/^[.\s]+/, "") || "documento";
}

/** MIME guardado según el tipo confirmado (OTHER: el que declaró el cliente, ya normalizado). */
export function documentMime(kind: DocumentKindName, clientMime: string): string {
  switch (kind) {
    case "TEXT": return "text/plain";
    case "MARKDOWN": return "text/markdown";
    case "HTML": return "text/html";
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
