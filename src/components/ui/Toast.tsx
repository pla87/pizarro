"use client";

import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

type ToastKind = "success" | "error" | "undo";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}
/** Botón del aviso (p. ej. «Deshacer»): al pulsarlo se ejecuta y el aviso se cierra. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

const ToastContext = createContext<(message: string, kind?: ToastKind, action?: ToastAction) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, kind: ToastKind = "success", action?: ToastAction) => {
    const id = nextId++;
    setItems((prev) => [...prev.slice(-3), { id, kind, message, action }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "error" || action ? 6000 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            // La región ya es «polite»; los errores se anuncian al momento.
            role={t.kind === "error" ? "alert" : undefined}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              t.kind === "error" ? "bg-red-600" : "bg-slate-900 dark:bg-slate-700",
            )}
          >
            {t.kind === "error" ? <AlertCircle size={16} className="shrink-0" /> : t.kind === "undo" ? <Undo2 size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
            {t.message}
            {t.action && (
              <button
                type="button"
                className="ml-1 shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                onClick={() => {
                  setItems((prev) => prev.filter((x) => x.id !== t.id));
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
