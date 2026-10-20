"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { undoLast } from "@/actions/undo";
import { useT } from "@/i18n/client";
import { cn } from "./ui/cn";
import { useToast } from "./ui/Toast";
import { UNDONE_EVENT, useUndoTask } from "./undo-context";

/**
 * Deshace la última acción del usuario en el proyecto (hasta 10 seguidas). Con una tarea abierta,
 * solo las de esa tarea. Con `shortcut`, también Ctrl/⌘+Z cuando no se está escribiendo.
 */
export function UndoButton({ projectId, shortcut = false, className }: { projectId: string; shortcut?: boolean; className?: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const taskId = useUndoTask();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await undoLast(projectId, taskId);
      if (!res.ok) return toast(res.error, "error");
      const { label, skipped } = res.data;
      toast(skipped ? t("Deshecho: {label} (parte ya no existía)", { label }) : t("Deshecho: {label}", { label }), "undo");
      if (taskId) window.dispatchEvent(new CustomEvent(UNDONE_EVENT, { detail: { taskId } }));
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [projectId, taskId, router, toast, t]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // Con un modal abierto solo cuenta si es el de una tarea (el contexto del deshacer).
      if (document.querySelector("[role=dialog]") && !taskId) return;
      e.preventDefault();
      void undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut, undo, taskId]);

  // Con una tarea abierta, el fondo del modal taparía el botón: se dibuja una copia encima, en el mismo sitio.
  useEffect(() => {
    if (!taskId) return;
    // Solo en escritorio: en móvil el modal ocupa la pantalla y la copia taparía su cabecera.
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      setRect(r && r.width > 0 && window.matchMedia("(min-width: 1024px)").matches ? r : null);
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [taskId]);

  const title = taskId ? t("Deshacer tu última acción en esta tarea") : shortcut ? t("Deshacer tu última acción en este tablero (hasta 10) · Ctrl+Z") : t("Deshacer tu última acción en este tablero (hasta 10)");
  const icon = busy ? <Loader2 size={18} className="animate-spin" /> : <Undo2 size={18} />;
  return (
    <>
      <button ref={ref} type="button" className={cn("btn-icon", className)} onClick={undo} disabled={busy} title={title} aria-label={t("Deshacer la última acción")}>
        {icon}
      </button>
      {taskId && rect &&
        createPortal(
          <button
            type="button"
            className="btn-icon fixed z-[70] bg-white shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onClick={undo}
            disabled={busy}
            title={title}
            aria-label={t("Deshacer la última acción en la tarea")}
          >
            {icon}
          </button>,
          document.body,
        )}
    </>
  );
}
