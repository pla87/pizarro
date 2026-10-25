import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { cardsAcceptFiles, filesFrom, hasFiles, uploadFile } from "./upload";

/**
 * Soltar archivos sobre una tarjeta del tablero (escritorio): se adjuntan a esa tarea con la misma ruta
 * de subida (y las mismas validaciones del servidor) que el diálogo. No usa el arrastre de dnd-kit
 * (que trabaja con eventos de puntero): son los eventos de arrastre nativos del navegador.
 */
export function useCardFileDrop(taskId: string, enabled: boolean) {
  const board = useBoard();
  const toast = useToast();
  const t = useT();
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

  const upload = async (files: File[]) => {
    setUploading((n) => n + files.length);
    let ok = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const att = await board.trackRaw(uploadFile(taskId, file, false, t));
        board.patchTask(taskId, att.totals);
        ok++;
      } catch (err) {
        errors.push((err as Error).message);
      } finally {
        if (alive.current) setUploading((n) => n - 1);
      }
    }
    if (ok) toast(ok === 1 ? t("1 archivo adjuntado a la tarea") : t("{n} archivos adjuntados a la tarea", { n: ok }));
    // Un solo aviso con el primer motivo (si fallan varios, normalmente es el mismo: el máximo de la tarea).
    if (errors.length) toast(errors.length > 1 ? `${errors[0]} (${t("{n} archivos no se han adjuntado", { n: errors.length })})` : errors[0]!, "error");
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
