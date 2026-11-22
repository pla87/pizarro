// Captura de lo que se ve detrás del diálogo «Informar de un error o enviar una sugerencia»: la página dibujada desde
// el DOM con modern-screenshot (se carga solo al marcar la casilla), sin los diálogos abiertos (`data-pz-modal`: el
// propio diálogo y su fondo oscuro). Nada sale del navegador hasta que la persona pulsa «Enviar» (o la descarga).
// Funciona con la CSP de la app: la imagen intermedia es un SVG en `data:` (img-src lo admite) y las fuentes y las
// imágenes de la página se leen del mismo origen (connect-src 'self'), sin workers ni scripts externos.
import { CAPTURE_ATTEMPTS, captureScale, SCREENSHOT_MAX_BYTES } from "@/lib/feedback-core";

const skip = (node: Node) => !(node instanceof Element && (node.hasAttribute("data-pz-modal") || node.hasAttribute("data-pz-no-capture")));

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function shrink(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  if (factor === 1) return canvas;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * factor));
  out.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = out.getContext("2d");
  ctx?.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** JPEG de la pantalla, de como mucho SCREENSHOT_MAX_WIDTH de ancho y SCREENSHOT_MAX_BYTES; lanza si no se puede. */
export async function captureScreen(): Promise<Blob> {
  const { domToCanvas } = await import("modern-screenshot");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = await domToCanvas(document.body, {
    width,
    height,
    scale: captureScale(width, window.devicePixelRatio),
    // El fondo de la página (claro u oscuro): sin él, lo que no tiene fondo propio saldría negro en el JPEG.
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    filter: skip,
    // Las zonas con scroll (el tablero, la columna, la página) se ven como están, no desde arriba.
    features: { restoreScrollPosition: true },
    timeout: 15_000,
  });
  let current = canvas;
  for (const attempt of CAPTURE_ATTEMPTS) {
    current = shrink(current, attempt.scale);
    const blob = await encode(current, attempt.quality);
    if (blob && blob.type === "image/jpeg" && blob.size <= SCREENSHOT_MAX_BYTES) return blob;
  }
  throw new Error("La captura no cabe");
}
