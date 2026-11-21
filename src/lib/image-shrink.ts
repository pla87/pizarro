// En el navegador: reducir una foto antes de subirla (adjuntos y Documentación). Sin React, para que lo importen módulos
// que también cargan las pruebas.

/**
 * El ancho que guarda el servidor (processImage en lib/uploads.ts: 1280 px de ancho como mucho, por ancho y no por lado),
 * igual en los adjuntos que en las imágenes de Documentación.
 */
const CLIENT_MAX_WIDTH = 1280;

/**
 * Reduce en el navegador las fotos grandes (JPEG, PNG y WebP) antes de subirlas (más rápido en móvil): al mismo ancho que
 * guardará el servidor, que no amplía, así que no se pierde nada y no se sube de más. El servidor hace siempre el
 * procesado definitivo con sharp, que no admite más de 30 megapíxeles: una foto de 48 MP solo se guarda como imagen si
 * llega ya reducida. Lo demás (y si el navegador no sabe reducirla) va tal cual.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  if (file.size < 1_500_000 || !/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width <= CLIENT_MAX_WIDTH) {
      bitmap.close();
      return file;
    }
    const scale = CLIENT_MAX_WIDTH / bitmap.width;
    const canvas = document.createElement("canvas");
    canvas.width = CLIENT_MAX_WIDTH;
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
