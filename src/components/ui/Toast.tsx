"use client";

import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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

/** Error de las acciones sin sesión (requireUser, 401): el servidor lo traduce al idioma de la instalación si ya no sabe quién eres. */
const SESSION_EXPIRED = "Sesión caducada. Vuelve a iniciar sesión.";
/** El aviso de sesión caducada se queda más tiempo: es lo único que lleva a volver a entrar sin perder lo escrito. */
const SESSION_TOAST_MS = 30000;

/** ¿Es el error de sesión caducada (en español o en el idioma de la interfaz)? */
export function isSessionExpiredMessage(message: string, t: (s: string) => string): boolean {
  return message === SESSION_EXPIRED || message === t(SESSION_EXPIRED);
}

/**
 * A la pantalla de acceso, con vuelta a la página actual (`next`). Navegación completa a propósito: al salir de la página
 * se guardan los borradores (título, descripción, tarea nueva… ver useDraftAutosave, que guarda en «pagehide») y, al
 * volver a entrar, la tarea se reabre con lo escrito. Nunca se hace sola: solo al pulsar el botón del aviso.
 */
export function goToLogin(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  // Carga completa (no router.push): así salta «pagehide» y se guardan los borradores antes de salir.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

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
  // El traductor por ref: `show` no cambia de identidad (hay efectos que dependen de él).
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  const [items, setItems] = useState<ToastItem[]>([]);
  const last = useRef<{ message: string; kind: ToastKind; at: number; id: number; timer: ReturnType<typeof setTimeout>; ms: number } | null>(null);
  // Aviso de sesión caducada visible: cada acción que falla después no apila otro igual, solo alarga el que hay.
  const sessionToast = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const show = useCallback((message: string, kind: ToastKind = "success", action?: ToastAction) => {
    // Sesión caducada a mitad de trabajo (cualquier acción, 401): el aviso lleva «Iniciar sesión» (en lugar del botón que
    // trajera, que sin sesión tampoco serviría), que abre la pantalla de acceso con vuelta a esta página. No se redirige
    // sin avisar: se perdería lo que se está escribiendo sin guardar.
    const t = tRef.current;
    if (kind === "error" && isSessionExpiredMessage(message, t)) {
      const hide = (id: number) => setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
        if (sessionToast.current?.id === id) sessionToast.current = null;
      }, SESSION_TOAST_MS);
      const cur = sessionToast.current;
      if (cur) {
        clearTimeout(cur.timer);
        cur.timer = hide(cur.id);
        return;
      }
      const id = nextId++;
      sessionToast.current = { id, timer: hide(id) };
      setItems((prev) => [...prev.slice(-3), { id, kind, message, action: { label: t("Iniciar sesión"), onClick: goToLogin } }]);
      return;
    }
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
        {items.map((item) => (
          <div
            key={item.id}
            // La región ya es «polite»; los errores se anuncian al momento.
            role={item.kind === "error" ? "alert" : undefined}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              item.kind === "error" ? "bg-red-600" : "bg-slate-900 dark:bg-slate-700",
            )}
          >
            {item.kind === "error" ? <AlertCircle size={16} className="shrink-0" /> : item.kind === "undo" ? <Undo2 size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
            <span><MessageWithLinks message={item.message} /></span>
            {item.action && (
              <button
                type="button"
                className="ml-1 shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                onClick={() => {
                  setItems((prev) => prev.filter((x) => x.id !== item.id));
                  item.action!.onClick();
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
