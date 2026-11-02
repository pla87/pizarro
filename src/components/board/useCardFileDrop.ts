import { useEffect, useRef, useState } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { batchErrorMessage, cardsAcceptFiles, filesFrom, hasFiles, monotonicTotals, skippedMessage, uploadBatch } from "./upload";
import { planUploads } from "@/lib/upload-queue";

/**
 * Soltar archivos sobre una tarjeta del tablero (escritorio): se adjuntan a esa tarea con la misma ruta
 * de subida (y las mismas validaciones del servidor) que el diálogo. No usa el arrastre de dnd-kit
 * (que trabaja con eventos de puntero): son los eventos de arrastre nativos del navegador.
 */
export function useCardFileDrop(taskId: string, enabled: boolean) {
  const board = useBoard();
  const toast = useToast();
  const t = useT();
  const locale = useIntlLocale();
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const depth = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Un arrastre que termina fuera de la tarjeta (o se cancela) no debe dejarla resaltada.
  useEffect(() => {
    if (!over) return;
    const reset = () => {
      depth.current = 0;
      setOver(false);
    };
    document.addEventListener("dragend", reset);
    document.addEventListener("drop", reset);
    return () => {
      document.removeEventListener("dragend", reset);
      document.removeEventListener("drop", reset);
    };
  }, [over]);

  const accepts = (e: React.DragEvent) => enabled && hasFiles(e) && cardsAcceptFiles();

  const upload = async (list: File[]) => {
    // Sin tope de cantidad: solo el tamaño de cada archivo y lo que aún cabe en la tarea. Lo omitido se avisa de una vez.
    const { fileMaxMb, attachMaxMb } = board.project;
    const used = board.getTask(taskId)?.attachBytes ?? 0;
    const { accepted, skipped } = planUploads(list, { fileMaxBytes: fileMaxMb * 1024 * 1024, remainingBytes: attachMaxMb * 1024 * 1024 - used });
    if (skipped.length) toast(skippedMessage(t, locale, skipped, fileMaxMb), "error");
    if (!accepted.length) return;
    setUploading((n) => n + accepted.length);
    const res = await uploadBatch(taskId, accepted, {
      t,
      track: board.trackRaw,
      onUploaded: (att) => board.patchTask(taskId, monotonicTotals(board.getTask(taskId), att.totals)),
    });
    if (alive.current) setUploading((n) => n - accepted.length);
    const ok = res.uploaded.length;
    if (ok) toast(ok === 1 ? t("1 archivo adjuntado a la tarea") : t("{n} archivos adjuntados a la tarea", { n: ok }));
    const msg = batchErrorMessage(t, res.errors, res.notSent);
    if (msg) toast(msg, "error");
  };

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault(); // necesario para que el navegador admita el drop
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      const files = filesFrom(e.dataTransfer.files);
      if (files.length) void upload(files);
    },
  };
  return { over, uploading, handlers };
}
