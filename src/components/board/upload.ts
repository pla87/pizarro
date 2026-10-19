import { useEffect, useRef, useState } from "react";
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

/** Archivos (de cualquier tipo) de un FileList o de los items de un portapapeles / arrastre. */
export function filesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file) files.push(file);
  }
  return files;
}

/** Solo imágenes (atajo de pegado del tablero que crea una tarea). */
export function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  return filesFrom(list).filter((f) => f.type.startsWith("image/"));
}

/** ¿El arrastre lleva archivos? (ignora arrastres internos de texto). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Tamaño legible: «840 KB», «2,3 MB». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export async function uploadFile(taskId: string, file: File): Promise<AttachmentInfo> {
  const body = new FormData();
  const isImage = isImageFile(file);
  const fallback = isImage ? `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png` : "archivo";
  const name = file.name && !(isImage && file.name === "image.png") ? file.name : fallback;
  body.append("file", isImage ? await shrink(file) : file, name);
  const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "No se pudo subir el archivo.");
  return json as AttachmentInfo;
}

/**
 * Arrastrar y soltar archivos en cualquier punto de la ventana mientras el diálogo está abierto.
 * Devuelve true mientras se arrastran archivos por encima (para mostrar el aviso). Ignora arrastres de texto.
 */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onFiles);
  useEffect(() => {
    cb.current = onFiles;
  });
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const reset = () => {
      depth = 0;
      setOver(false);
    };
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault(); // necesario para que el navegador admita el drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!has(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      reset();
      const files = filesFrom(e.dataTransfer?.files);
      if (files.length) cb.current(files);
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", overFn);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    document.addEventListener("dragend", reset);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", overFn);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      document.removeEventListener("dragend", reset);
    };
  }, []);
  return over;
}
