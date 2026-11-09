import { useEffect, useRef } from "react";
import { isEmptyImage, isTextSnapshot, pickClipboardFiles } from "@/lib/clipboard-files";

// Archivos pegados con Ctrl/⌘+V. Un pegado se procesa una sola vez, aunque lo vean varios manejadores (campo, editor,
// diálogo, tablero): los File se leen de forma síncrona dentro del evento (después el portapapeles ya no los da) y se
// guardan por evento, y el primero que adjunta lo «reclama» para que nadie más lo repita.

const readFiles = new WeakMap<Event, File[]>();
const claimed = new WeakSet<Event>();

/** Archivos del pegado, sin duplicados; la misma lista (los mismos File) para todos los manejadores de este evento. */
export function pastedFiles(e: ClipboardEvent): File[] {
  let files = readFiles.get(e);
  if (!files) {
    const dt = e.clipboardData;
    files = dt ? pickClipboardFiles(dt.files, dt.items) : [];
    readFiles.set(e, files);
  }
  return files;
}

/** Caja de texto (campo, área de texto o editor): ahí un texto copiado se pega como texto. */
export function isTextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input, textarea, [contenteditable=true], [contenteditable='']");
}

/**
 * Archivos que se adjuntan de este pegado. En una caja de texto no cuenta la imagen que Word, Excel o Outlook añaden al
 * copiar texto (es una foto de lo copiado): entra el texto o la tabla, sin adjunto.
 */
export function attachablePasteFiles(e: ClipboardEvent): File[] {
  const files = pastedFiles(e);
  if (!files.length || !isTextTarget(e.target)) return files;
  const plain = e.clipboardData?.getData("text/plain") ?? "";
  const html = e.clipboardData?.getData("text/html") ?? "";
  return files.filter((f) => !isTextSnapshot(f, plain, html));
}

/** Este pegado ya se ha adjuntado en algún sitio. */
export function pasteClaimed(e: Event): boolean {
  return claimed.has(e);
}

/** Adjunta este pegado: nadie más lo procesa y el navegador no pega nada en la caja. */
export function claimPaste(e: ClipboardEvent): void {
  claimed.add(e);
  e.preventDefault();
}

/**
 * Imágenes que el evento dio vacías (0 bytes: el navegador no pudo leerlas del portapapeles del sistema, algo que pasa
 * con capturas en Windows): se piden otra vez con la API asíncrona del portapapeles. Si no se puede, quedan como estaban
 * (y se avisa una vez al adjuntar).
 */
export async function recoverEmptyImages(files: File[]): Promise<File[]> {
  if (!files.some(isEmptyImage) || typeof navigator === "undefined" || !navigator.clipboard?.read) return files;
  try {
    const images: Blob[] = [];
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) images.push(await item.getType(type));
    }
    const full = images.filter((b) => b.size > 0);
    let next = 0;
    return files.map((f) => {
      if (!isEmptyImage(f) || next >= full.length) return f;
      const blob = full[next++]!;
      return new File([blob], f.name || "image.png", { type: blob.type || f.type || "image/png" });
    });
  } catch {
    return files;
  }
}

interface Zone {
  el: () => Element | null;
}
/** Diálogos que adjuntan lo pegado, en orden de apertura. */
const zones: Zone[] = [];

/**
 * Diálogo al que va un pegado: el que contiene el elemento con el foco; si el foco no está en ningún diálogo (página,
 * fondo), el último abierto. Dentro de otro diálogo (confirmación, visor de imágenes), ninguno.
 */
function ownerOf(target: EventTarget | null): Zone | null {
  const node = target instanceof Node ? target : null;
  const inside = node ? [...zones].reverse().find((z) => z.el()?.contains(node)) : undefined;
  if (inside) return inside;
  const el = node instanceof Element ? node : node?.parentElement;
  if (el?.closest("[role=dialog]")) return null;
  return zones[zones.length - 1] ?? null;
}

/**
 * Pegar archivos en un diálogo (nueva tarea, detalle): con el foco en el título, la descripción, una subtarea, un
 * botón o fuera de cualquier caja. `scope` devuelve el elemento del diálogo. Una sola llamada a `onFiles` por pegado.
 */
export function usePasteFiles(onFiles: (files: File[]) => void, scope: () => Element | null): void {
  const handlers = useRef({ onFiles, scope });
  useEffect(() => {
    handlers.current = { onFiles, scope };
  });
  useEffect(() => {
    const zone: Zone = { el: () => handlers.current.scope() };
    zones.push(zone);
    const onPaste = (e: ClipboardEvent) => {
      if (pasteClaimed(e) || ownerOf(e.target) !== zone) return;
      const files = attachablePasteFiles(e);
      if (!files.length) return;
      claimPaste(e);
      if (!files.some(isEmptyImage)) return handlers.current.onFiles(files);
      void recoverEmptyImages(files).then((list) => handlers.current.onFiles(list));
    };
    document.addEventListener("paste", onPaste);
    return () => {
      zones.splice(zones.indexOf(zone), 1);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
}
