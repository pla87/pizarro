import { useEffect, useRef, useState } from "react";
import { makeT, type T } from "@/i18n/core";
import type { UploadedAttachment } from "@/lib/types";
import { QueueStopped, runQueue, summarizeSkipped, withRetry, type SkippedFile } from "@/lib/upload-queue";

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
  constructor(message: string, public readonly code?: string, public readonly status?: number, public readonly retryAfterSec?: number | null) {
    super(message);
  }
}

/** `onCreate`: adjunto de una tarea recién creada (deshacer la creación se lo lleva, no cuenta aparte). Reintenta con calma ante 429/503. */
export async function uploadFile(taskId: string, file: File, onCreate = false, t: T = makeT("es"), signal?: AbortSignal): Promise<UploadedAttachment> {
  const isImage = isImageFile(file);
  const fallback = isImage ? `${t("captura")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png` : t("archivo");
  const name = file.name && !(isImage && file.name === "image.png") ? file.name : fallback;
  const blob = isImage ? await shrink(file) : file;
  return withRetry(async () => {
    const body = new FormData();
    body.append("file", blob, name);
    const res = await fetch(`/api/tasks/${taskId}/attachments${onCreate ? "?alCrear=1" : ""}`, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      throw new UploadError(json.error ?? t("No se pudo subir el archivo."), json.code, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    return json as UploadedAttachment;
  }, { signal });
}

type Totals = { imageCount: number; fileCount: number; attachBytes: number };

/**
 * Contadores de la tarjeta tras una subida: con varias en paralelo las respuestas pueden llegar desordenadas, así que
 * cada contador solo sube (el máximo entre lo que hay y lo que trae la respuesta). Borrados y demás los corrige el detalle.
 */
export function monotonicTotals(current: Partial<Totals> | undefined, next: Totals): Totals {
  return {
    imageCount: Math.max(current?.imageCount ?? 0, next.imageCount),
    fileCount: Math.max(current?.fileCount ?? 0, next.fileCount),
    attachBytes: Math.max(current?.attachBytes ?? 0, next.attachBytes),
  };
}

/**
 * Une el progreso de varias tandas simultáneas en uno solo (totales y terminadas sumados). Mientras quede alguna en
 * marcha las ya terminadas siguen contando; solo cuando acaban todas se limpia (set(null)).
 */
export function createProgressAggregator(set: (p: BatchProgress | null) => void) {
  const batches = new Map<number, { p: BatchProgress; finished: boolean }>();
  let seq = 0;
  const publish = () => {
    if (!batches.size) return set(null);
    let total = 0, done = 0;
    const active: string[] = [];
    for (const { p } of batches.values()) {
      total += p.total;
      done += p.done;
      active.push(...p.active);
    }
    set({ total, done, active });
  };
  return {
    start() {
      const id = ++seq;
      return {
        update(p: BatchProgress) {
          batches.set(id, { p, finished: false });
          publish();
        },
        finish() {
          const b = batches.get(id);
          if (b) b.finished = true;
          if ([...batches.values()].every((x) => x.finished)) batches.clear();
          publish();
        },
      };
    },
  };
}

/** Progreso de una tanda de subidas: total, terminadas (bien o mal) y nombres de las que van ahora. */
export interface BatchProgress {
  total: number;
  done: number;
  active: string[];
}

export interface BatchResult {
  uploaded: UploadedAttachment[];
  /** Mensajes de error de las subidas fallidas (sin las que no llegaron a empezar). */
  errors: string[];
  /** Una subida superó el máximo de la tarea: las demás se dejaron sin enviar. */
  totalRejected: boolean;
  /** Nº de archivos que no se enviaron por haberse detenido la cola. */
  notSent: number;
}

/**
 * Sube una lista de archivos a una tarea por una cola de 3 a la vez (las que admite el servidor), sin tope de cantidad.
 * `onUploaded` se llama según termina cada una (para ir pintando el adjunto); `onProgress` con el avance de la tanda.
 */
export async function uploadBatch(
  taskId: string,
  files: File[],
  opts: { onCreate?: boolean; t?: T; track?: <R>(p: Promise<R>) => Promise<R>; onUploaded?: (a: UploadedAttachment) => void; onProgress?: (p: BatchProgress) => void; signal?: AbortSignal } = {},
): Promise<BatchResult> {
  const t = opts.t ?? makeT("es");
  const active = new Map<number, string>();
  let done = 0;
  const report = () => opts.onProgress?.({ total: files.length, done, active: [...active.values()] });
  report();
  const results = await runQueue(
    files,
    async (file) => {
      const send = uploadFile(taskId, file, opts.onCreate ?? false, t, opts.signal);
      const att = await (opts.track ? opts.track(send) : send);
      opts.onUploaded?.(att);
      return att;
    },
    {
      onStart: (i) => {
        active.set(i, files[i]!.name);
        report();
      },
      onSettle: (i) => {
        active.delete(i);
        done++;
        report();
      },
      stopWhen: (reason) => reason instanceof UploadError && (reason.code === "task_total" || reason.code === "quota_total" || reason.code === "quota_project"),
      signal: opts.signal,
    },
  );
  const uploaded: UploadedAttachment[] = [];
  const errors: string[] = [];
  let notSent = 0;
  let totalRejected = false;
  for (const r of results) {
    if (r.status === "fulfilled") uploaded.push(r.value);
    else if (r.reason instanceof QueueStopped) notSent++;
    else {
      if (r.reason instanceof UploadError && r.reason.code === "task_total") totalRejected = true;
      errors.push((r.reason as Error).message);
    }
  }
  return { uploaded, errors, totalRejected, notSent };
}

/** Aviso único de los archivos omitidos antes de subir (con el motivo de cada uno). */
export function skippedMessage(t: T, locale: string, skipped: SkippedFile[], fileMaxMb: number): string {
  const why = (s: SkippedFile) =>
    s.reason === "empty" ? t("vacío") : s.reason === "too_big" ? t("pesa {size}, máx. {mb} MB", { size: formatBytes(s.size, locale), mb: fileMaxMb }) : t("no cabe en el máximo de la tarea");
  const list = summarizeSkipped(skipped, (s) => `«${s.name || t("archivo")}» (${why(s)})`);
  return skipped.length === 1 ? t("1 archivo no se ha adjuntado: {list}", { list }) : t("{n} archivos no se han adjuntado: {list}", { n: skipped.length, list });
}

/** Una sola frase para los fallos de una tanda: el primer motivo y cuántos más. */
export function batchErrorMessage(t: T, errors: string[], notSent: number): string | null {
  const count = errors.length + notSent;
  if (!count) return null;
  const first = errors[0] ?? t("No se pudo subir el archivo.");
  return count > 1 ? `${first} (${t("{n} archivos no se han adjuntado", { n: count })})` : first;
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
      // Soltado sobre «Documentación» del menú: lo gestiona el menú (sube a la documentación del proyecto).
      if (e.target instanceof Element && e.target.closest("[data-docs-drop]")) return;
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
