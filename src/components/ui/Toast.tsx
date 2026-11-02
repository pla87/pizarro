"use client";

import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useT } from "@/i18n/client";
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

// Rutas internas que un aviso de error puede traer (cuota de almacenamiento superada, para administradores): se pintan como enlace.
const SETTINGS_PATH = /(\/p\/[a-z0-9]+\/settings\?tab=adjuntos|\/admin\/settings)(?![\w/?=&-])/i;

export function MessageWithLinks({ message }: { message: string }) {
  const t = useT();
  const parts = message.split(SETTINGS_PATH);
  if (parts.length === 1) return <>{message}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={part} className="font-semibold underline underline-offset-2">{t("Abrir ajustes")}</Link>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const last = useRef<{ message: string; kind: ToastKind; at: number; id: number; timer: ReturnType<typeof setTimeout>; ms: number } | null>(null);
  const show = useCallback((message: string, kind: ToastKind = "success", action?: ToastAction) => {
    // Un aviso idéntico al anterior (mismo texto y tipo) y reciente no se repite: varias acciones seguidas con el mismo
    // resultado (o un doble clic) no apilan avisos iguales. Los que traen botón sí se muestran.
    const now = Date.now();
    if (!action && last.current && last.current.message === message && last.current.kind === kind && now - last.current.at < 2000) {
      // Se descarta el duplicado, pero el aviso visible vuelve a contar su tiempo.
      const cur = last.current;
      clearTimeout(cur.timer);
      cur.timer = setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== cur.id)), cur.ms);
      return;
    }
    const id = nextId++;
    const ms = kind === "error" || action ? 6000 : 2500;
    const timer = setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ms);
    last.current = { message, kind, at: now, id, timer, ms };
    setItems((prev) => [...prev.slice(-3), { id, kind, message, action }]);
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
            <span><MessageWithLinks message={t.message} /></span>
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
