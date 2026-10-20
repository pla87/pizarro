"use client";

import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

type ToastKind = "success" | "error" | "undo";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId++;
    setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 6000 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              t.kind === "error" ? "bg-red-600" : "bg-slate-900 dark:bg-slate-700",
            )}
          >
            {t.kind === "error" ? <AlertCircle size={16} className="shrink-0" /> : t.kind === "undo" ? <Undo2 size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
