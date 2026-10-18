import type { AttachmentInfo } from "@/lib/types";

const CLIENT_MAX_WIDTH = 1920;

/**
 * Reduce en el navegador las fotos grandes antes de subirlas (más rápido en móvil).
 * El servidor hace siempre el procesado definitivo con sharp.
 */
async function shrink(file: File): Promise<Blob> {
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

export function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

export async function uploadImage(taskId: string, file: File): Promise<AttachmentInfo> {
  const body = new FormData();
  const name = file.name && file.name !== "image.png" ? file.name : `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  body.append("file", await shrink(file), name);
  const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "No se pudo subir la imagen.");
  return json as AttachmentInfo;
}
