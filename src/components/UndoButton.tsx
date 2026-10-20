"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { undoLast } from "@/actions/undo";
import { cn } from "./ui/cn";
import { useToast } from "./ui/Toast";

/**
 * Deshace la última acción del usuario en el proyecto (hasta 10 seguidas). Con `shortcut`,
 * también Ctrl/⌘+Z cuando no se está escribiendo ni hay un modal abierto.
 */
export function UndoButton({ projectId, shortcut = false, className }: { projectId: string; shortcut?: boolean; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await undoLast(projectId);
      if (!res.ok) return toast(res.error, "error");
      const { label, remaining, skipped } = res.data;
      toast(`Deshecho: ${label}${skipped ? " (parte ya no existía)" : ""}${remaining ? ` · quedan ${remaining}` : ""}`);
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [projectId, router, toast]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      void undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut, undo]);

  return (
    <button
      type="button"
      className={cn("btn-icon", className)}
      onClick={undo}
      disabled={busy}
      title={`Deshacer tu última acción en este tablero (hasta 10)${shortcut ? " · Ctrl+Z" : ""}`}
      aria-label="Deshacer la última acción"
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : <Undo2 size={18} />}
    </button>
  );
}
