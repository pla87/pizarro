// Archivos de un pegado (Ctrl/⌘+V), sin React ni DOM para poder probarlo: qué archivos trae, sin duplicados, y cuáles
// son solo la «foto» que Office y otros programas añaden al copiar texto.

/** Lo que se usa de un DataTransferItem del portapapeles. */
export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

/** Nombre que Chrome da a la imagen del portapapeles cuando no viene de un archivo (captura, «Copiar imagen»…). */
export const CLIPBOARD_IMAGE_NAME = "image.png";

const fileKey = (f: File) => `${f.name}\u0000${f.type}\u0000${f.size}`;

/**
 * Lista sin repetidos (mismo nombre, tipo y tamaño). Si un archivo vacío tiene un gemelo con contenido (mismo nombre y
 * tipo), queda el que tiene contenido.
 */
export function dedupeFiles(list: readonly File[]): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    const key = fileKey(f);
    if (seen.has(key)) continue;
    if (f.size === 0 && list.some((g) => g.size > 0 && g.name === f.name && g.type === f.type)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Archivos de un pegado, leídos una sola vez y de forma síncrona (fuera del evento, el portapapeles ya está vacío).
 * `files` y `items` describen los mismos archivos (y en Chrome cada lectura devuelve un File nuevo): se toma `files` y
 * solo se recurre a `items` si `files` no trae nada o trae alguno vacío (Safari a veces solo los da en `items`).
 */
export function pickClipboardFiles(files: ArrayLike<File> | null | undefined, items: ArrayLike<ClipboardItemLike> | null | undefined): File[] {
  const fromFiles = files ? Array.from(files) : [];
  if (fromFiles.length && fromFiles.every((f) => f.size > 0)) return dedupeFiles(fromFiles);
  const fromItems: File[] = [];
  for (const item of items ? Array.from(items) : []) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (f) fromItems.push(f);
  }
  return dedupeFiles([...fromFiles, ...fromItems]);
}

const RAW_OPEN = /^<(style|script|head|title)\b/i;
const visibleText = (s: string) => /\S/.test(s.replace(/&nbsp;|&#160;|&#xa0;/gi, " "));

/**
 * ¿El HTML tiene texto visible (no solo etiquetas, una imagen o espacios)? Sin comentarios ni el contenido de
 * <style>/<script>/<head>/<title>. Recorre el texto una vez: con expresiones regulares, muchos «<» o «<style» sin cerrar
 * tardaban un tiempo cuadrático (segundos con un pegado de unos cientos de KB).
 */
export function htmlHasText(html: string): boolean {
  /** Etiquetas sin cierre más adelante (si no lo hay desde aquí, tampoco desde más lejos: no se vuelve a buscar). */
  const unclosed = new Set<string>();
  for (let i = 0; i < html.length; ) {
    const lt = html.indexOf("<", i);
    if (visibleText(html.slice(i, lt < 0 ? html.length : lt))) return true;
    if (lt < 0) return false;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end >= 0) {
        i = end + 3;
        continue;
      }
    }
    const raw = RAW_OPEN.exec(html.slice(lt, lt + 7))?.[1]?.toLowerCase();
    if (raw && !unclosed.has(raw)) {
      const close = new RegExp(`</${raw}\\s*>`, "gi");
      close.lastIndex = lt;
      const m = close.exec(html);
      if (m) {
        i = m.index + m[0].length;
        continue;
      }
      unclosed.add(raw);
    }
    // Una etiqueta cualquiera, hasta su «>»; un «<» suelto, sin «>» después, es texto.
    const gt = html.indexOf(">", lt);
    if (gt < 0) return true;
    i = gt + 1;
  }
  return false;
}

/**
 * Imagen que acompaña a un texto copiado: Word, Excel, PowerPoint u Outlook ponen en el portapapeles, además del texto,
 * una imagen de la selección (Chrome la entrega como «image.png»). Pegando en una caja de texto, lo que se quiere es el
 * texto (o la tabla), no una foto de él. Una captura o «Copiar imagen» no traen texto y sí se adjuntan.
 */
export function isTextSnapshot(file: File, plain: string, html: string): boolean {
  return file.name === CLIPBOARD_IMAGE_NAME && file.type.startsWith("image/") && /\S/.test(plain) && htmlHasText(html);
}

/** Imágenes vacías: el navegador no pudo leer la imagen del portapapeles (se intenta de nuevo con la API asíncrona). */
export function isEmptyImage(file: File): boolean {
  return file.size === 0 && (file.type.startsWith("image/") || file.name === CLIPBOARD_IMAGE_NAME);
}
