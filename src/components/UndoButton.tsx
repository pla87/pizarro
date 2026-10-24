"use client";

import { Loader2, Redo2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { redoLast, undoLast } from "@/actions/undo";
import { useT } from "@/i18n/client";
import { cn } from "./ui/cn";
import { useToast } from "./ui/Toast";
import { isTypingTarget, useShortcut } from "./board/shortcuts";
import { UNDONE_EVENT, useBoardModalOpen, useUndoTask } from "./undo-context";
import { useFloatingRect } from "./ui/useFloatingRect";

/**
 * Deshacer y rehacer, uno junto al otro. Deshace la última acción del usuario en el proyecto (hasta 10
 * seguidas); con una tarea abierta, solo las de esa tarea. Rehacer devuelve lo último deshecho (una
 * acción nueva lo vacía). Con `shortcut`: Ctrl/⌘+Z y Alt+Z deshacen; Ctrl/⌘+Shift+Z, Ctrl/⌘+Y y Alt+Shift+Z
 * rehacen (Alt+ = tablero entero), cuando no se está escribiendo.
 * Con `inDialog` (cabecera del detalle en móvil, que tapa la del tablero): mismos botones, sin copias flotantes.
 */
export function UndoButton({ projectId, shortcut = false, inDialog = false, className }: { projectId: string; shortcut?: boolean; inDialog?: boolean; className?: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const taskId = useUndoTask();
  const sc = useShortcut();
  const [busy, setBusy] = useState<"undo" | "redo" | null>(null);
  const busyRef = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);

  // `scope`: la tarea abierta (por defecto) o null para deshacer en todo el tablero (Alt+Z).
  const run = useCallback(async (redo: boolean, scope: string | null = taskId) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(redo ? "redo" : "undo");
    try {
      const res = await (redo ? redoLast : undoLast)(projectId, scope);
      if (!res.ok) return toast(res.error, "error");
      const { label, skipped } = res.data;
      toast(
        redo
          ? skipped ? t("Rehecho: {label} (parte ya no existía)", { label }) : t("Rehecho: {label}", { label })
          : skipped ? t("Deshecho: {label} (parte ya no existía)", { label }) : t("Deshecho: {label}", { label }),
        "undo",
      );
      // Con una tarea abierta se recarga su detalle también tras un Alt+Z (puede haber deshecho algo suyo).
      if (taskId) window.dispatchEvent(new CustomEvent(UNDONE_EVENT, { detail: { taskId } }));
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [projectId, taskId, router, toast, t]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      // Alt+Z / Alt+Shift+Z (⌥Z en Mac): deshacer o rehacer en el tablero entero, aunque haya una tarea abierta.
      if (e.altKey && e.code === "KeyZ" && !e.ctrlKey && !e.metaKey && !e.repeat) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        void run(e.shiftKey, null);
        return;
      }
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const redo = mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || (e.key.toLowerCase() === "y" && !e.shiftKey));
      const undo = mod && e.key.toLowerCase() === "z" && !e.shiftKey;
      if (!redo && !undo) return;
      if (isTypingTarget(e.target)) return;
      // Con un modal abierto solo cuenta si es el de una tarea (el contexto del deshacer).
      if (document.querySelector("[role=dialog]") && !taskId) return;
      e.preventDefault();
      void run(redo);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut, run, taskId]);

  // Con un diálogo de tarea abierto (existente o nueva), el fondo del modal taparía el botón: se dibuja una copia encima, en el mismo sitio.
  const boardModal = useBoardModalOpen();
  const floating = !inDialog && (!!taskId || boardModal);
  const rect = useFloatingRect(ref, floating);
  const redoRect = useFloatingRect(redoRef, floating);

  const undoTitle = taskId
    ? t("Deshacer tu última acción en esta tarea")
    : shortcut ? t("Deshacer tu última acción en este tablero (hasta 10) · {keys}", { keys: `${sc("Ctrl+Z")}, ${sc("Alt+Z")}` }) : t("Deshacer tu última acción en este tablero (hasta 10)");
  const redoTitle = taskId
    ? t("Rehacer lo último que has deshecho en esta tarea")
    : shortcut ? t("Rehacer lo último que has deshecho en este tablero · {keys}", { keys: `${sc("Ctrl+Shift+Z")}, ${sc("Ctrl+Y")}, ${sc("Alt+Shift+Z")}` }) : t("Rehacer lo último que has deshecho en este tablero");
  const spin = <Loader2 size={18} className="animate-spin" />;
  const floatingCls = "btn-icon fixed z-[70] bg-white shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700";
  const undoIcon = busy === "undo" ? spin : <Undo2 size={18} />;
  const redoIcon = busy === "redo" ? spin : <Redo2 size={18} />;
  return (
    <>
      <button ref={ref} type="button" className={cn("btn-icon", className)} onClick={() => void run(false)} disabled={!!busy} title={undoTitle} aria-label={inDialog ? t("Deshacer la última acción en la tarea") : t("Deshacer la última acción")}>
        {undoIcon}
      </button>
      <button ref={redoRef} type="button" className={cn("btn-icon", className)} onClick={() => void run(true)} disabled={!!busy} title={redoTitle} aria-label={inDialog ? t("Rehacer la última acción en la tarea") : t("Rehacer la última acción")}>
        {redoIcon}
      </button>
      {floating && rect &&
        createPortal(
          <button
            type="button"
            className={floatingCls}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onClick={() => void run(false)}
            disabled={!!busy}
            title={undoTitle}
            aria-label={t("Deshacer la última acción en la tarea")}
          >
            {undoIcon}
          </button>,
          document.body,
        )}
      {floating && redoRect &&
        createPortal(
          <button
            type="button"
            className={floatingCls}
            style={{ left: redoRect.left, top: redoRect.top, width: redoRect.width, height: redoRect.height }}
            onClick={() => void run(true)}
            disabled={!!busy}
            title={redoTitle}
            aria-label={t("Rehacer la última acción en la tarea")}
          >
            {redoIcon}
          </button>,
          document.body,
        )}
    </>
  );
}
