"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  /** Título corto del diálogo («Borrar tarea»). Por defecto, «Confirmar». */
  title?: string;
  message: React.ReactNode;
  /** Texto del botón de aceptar. Por defecto, «Confirmar». */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: el botón de aceptar va en rojo y el foco empieza en «Cancelar». */
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** `const confirm = useConfirm(); if (!(await confirm({ message, danger: true }))) return;` — sustituye a window.confirm. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm fuera de <ConfirmProvider>");
  return confirm;
}

interface Pending {
  id: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

let nextId = 1;

/**
 * Diálogo de confirmación dentro de la app (sobre el Modal: trampa de foco y Escape). Se pueden apilar: una
 * confirmación pedida desde otro modal se abre encima y, al cerrarla, el foco vuelve a donde estaba.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Pending[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => {
    stackRef.current = stack;
  });
  // Si el proveedor desaparece con confirmaciones abiertas, se resuelven como «no».
  useEffect(() => () => stackRef.current.forEach((p) => p.resolve(false)), []);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setStack((prev) => [...prev, { id: nextId++, options, resolve }]);
      }),
    [],
  );
  const settle = useCallback((id: number, ok: boolean) => {
    const item = stackRef.current.find((p) => p.id === id);
    if (!item) return;
    item.resolve(ok);
    setStack((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {stack.map((p) => (
        <ConfirmDialog key={p.id} {...p.options} onResult={(ok) => settle(p.id, ok)} />
      ))}
    </ConfirmContext.Provider>
  );
}

/** El diálogo en sí (lo usa el proveedor; también sirve suelto si se necesita controlarlo a mano). */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, onResult }: ConfirmOptions & { onResult: (ok: boolean) => void }) {
  const t = useT();
  return (
    <Modal
      open
      onClose={() => onResult(false)}
      title={title ?? t("Confirmar")}
      size="sm"
      footer={
        <>
          {/* Acción destructiva: el foco empieza en el botón seguro. */}
          <button type="button" className="btn-secondary" onClick={() => onResult(false)} data-autofocus={danger ? true : undefined}>
            {cancelLabel ?? t("Cancelar")}
          </button>
          <button type="button" className={danger ? "btn-danger" : "btn-primary"} onClick={() => onResult(true)} data-autofocus={danger ? undefined : true}>
            {confirmLabel ?? t("Confirmar")}
          </button>
        </>
      }
    >
      <div className="text-sm whitespace-pre-line text-slate-700 dark:text-slate-300">{message}</div>
    </Modal>
  );
}
