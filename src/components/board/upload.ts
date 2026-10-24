import { useEffect, useRef, useState } from "react";
import { makeT, type T } from "@/i18n/core";
import type { AttachmentInfo, BoardTask } from "@/lib/types";

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

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Tamaño legible: «840 KB», «2,3 MB». */
export function formatBytes(bytes: number, locale = "es-ES"): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `${locale.startsWith("es") ? mb.replace(".", ",") : mb} MB`;
}

/** Megas legibles con un decimal como mucho: «45», «12,5». */
export function mbText(bytes: number, locale = "es-ES"): string {
  const mb = (Math.round((bytes / 1024 / 1024) * 10) / 10).toString();
  return locale.startsWith("es") ? mb.replace(".", ",") : mb;
}

/** Fallo de subida; `code` = «task_total» cuando se supera el máximo de adjuntos de la tarea. */
export class UploadError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

/** Cambio de los contadores de la tarjeta al añadir (+1) o quitar (-1) un adjunto. */
export function attachmentPatch(task: BoardTask, att: Pick<AttachmentInfo, "isImage" | "size">, sign: 1 | -1 = 1): Partial<BoardTask> {
  const attachBytes = Math.max(0, task.attachBytes + sign * att.size);
  return att.isImage
    ? { imageCount: Math.max(0, task.imageCount + sign), attachBytes }
    : { fileCount: Math.max(0, task.fileCount + sign), attachBytes };
}

/** `onCreate`: adjunto de una tarea recién creada (deshacer la creación se lo lleva, no cuenta aparte). */
export async function uploadFile(taskId: string, file: File, onCreate = false, t: T = makeT("es")): Promise<AttachmentInfo> {
  const body = new FormData();
  const isImage = isImageFile(file);
  const fallback = isImage ? `${t("captura")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png` : t("archivo");
  const name = file.name && !(isImage && file.name === "image.png") ? file.name : fallback;
  body.append("file", isImage ? await shrink(file) : file, name);
  const res = await fetch(`/api/tasks/${taskId}/attachments${onCreate ? "?alCrear=1" : ""}`, { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(json.error ?? t("No se pudo subir el archivo."), json.code);
  return json as AttachmentInfo;
}

/** Diálogos con zona de soltado abiertos: solo el último (el de más arriba) recibe los archivos. */
const dropStack: object[] = [];

/** Sin ningún diálogo con zona de soltado abierto: las tarjetas del tablero pueden recibir archivos. */
export function cardsAcceptFiles(): boolean {
  return dropStack.length === 0;
}

/** Un arrastre trae archivos (y no, p. ej., texto o una tarjeta). */
export function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
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
    const token = {};
    dropStack.push(token);
    const isTop = () => dropStack[dropStack.length - 1] === token;
    const has = (e: DragEvent) => isTop() && Array.from(e.dataTransfer?.types ?? []).includes("Files");
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
      dropStack.splice(dropStack.indexOf(token), 1);
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", overFn);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      document.removeEventListener("dragend", reset);
    };
  }, []);
  return over;
}

/**
 * El tablero ignora los archivos soltados fuera de una tarjeta o de un diálogo: sin esto el navegador
 * abriría el archivo y saldría de la aplicación. Las tarjetas (y los diálogos) los gestionan antes.
 */
export function useBlockStrayFileDrops(): void {
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.defaultPrevented || !cardsAcceptFiles() || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    document.addEventListener("dragover", block);
    document.addEventListener("drop", block);
    return () => {
      document.removeEventListener("dragover", block);
      document.removeEventListener("drop", block);
    };
  }, []);
}
