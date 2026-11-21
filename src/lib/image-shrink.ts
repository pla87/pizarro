// En el navegador: reducir una foto antes de subirla (adjuntos y Documentación). Sin React, para que lo importen módulos
// que también cargan las pruebas.

/**
 * El ancho que guarda el servidor (processImage en lib/uploads.ts: 1280 px de ancho como mucho, por ancho y no por lado),
 * igual en los adjuntos que en las imágenes de Documentación.
 */
const CLIENT_MAX_WIDTH = 1280;
/** Por debajo de este peso no merece la pena reducir: se sube tal cual (salvo con `checkPixels`). */
const SMALL_BYTES = 1_500_000;
/** Lo que admite sharp en el servidor (MAX_INPUT_PIXELS en lib/uploads.ts). */
const SERVER_MAX_PIXELS = 30_000_000;

/**
 * Reduce en el navegador las fotos grandes (JPEG, PNG y WebP) antes de subirlas (más rápido en móvil): al mismo ancho que
 * guardará el servidor, que no amplía, así que no se pierde nada y no se sube de más. El servidor hace siempre el
 * procesado definitivo con sharp, que no admite más de 30 megapíxeles: una foto de 48 MP solo se guarda como imagen si
 * llega ya reducida. Lo demás (y si el navegador no sabe reducirla) va tal cual.
 * `checkPixels` (Documentación): una imagen ligera (menos de 1,5 MB) también se mira y se reduce si pasa de esos 30 MP
 * (una imagen muy lisa pesa poco aunque tenga muchos píxeles); si no, va tal cual, como siempre.
 */
export async function shrinkImage(file: File, { checkPixels = false }: { checkPixels?: boolean } = {}): Promise<Blob> {
  const small = file.size < SMALL_BYTES;
  if ((small && !checkPixels) || !/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width <= CLIENT_MAX_WIDTH || (small && bitmap.width * bitmap.height <= SERVER_MAX_PIXELS)) {
      bitmap.close();
      return file;
    }
    // Más de lo que admite el servidor: la reducida aunque pese más (la original no se guardaría como imagen).
    const tooBig = bitmap.width * bitmap.height > SERVER_MAX_PIXELS;
    const scale = CLIENT_MAX_WIDTH / bitmap.width;
    const canvas = document.createElement("canvas");
    canvas.width = CLIENT_MAX_WIDTH;
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
    return blob && (blob.size < file.size || tooBig) ? blob : file;
  } catch {
    return file;
  }
}
