"use client";

import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "./cn";
import { MAX_TOASTS, placeToast, toastMs, trimToasts } from "./toast-queue";
import { isSessionExpiredMessage, SESSION_EXPIRED } from "./session-expired";

type ToastKind = "success" | "error" | "undo";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** El de sesión caducada: en móvil no se oculta aunque lleguen otros. */
  pinned?: boolean;
  /** Su «Deshacer» ya no sirve: llegó otro aviso con «Deshacer» después (placeToast, toast-queue.ts). */
  stale?: boolean;
  /** Avisos que se sustituyen en su sitio (ToastOptions.replace). */
  group?: string;
}
/**
 * Botón del aviso (p. ej. «Deshacer»): al pulsarlo se ejecuta y el aviso se cierra. Un «Deshacer» deshace lo último que se
 * hizo: al llegar otro aviso con «Deshacer» deja de ofrecerse (ver placeToast). `independent`: deshace algo concreto que no
 * depende del orden (devolver un documento de la papelera), así que se mantiene.
 */
interface ToastAction {
  label: string;
  onClick: () => void;
  independent?: boolean;
}
/**
 * `replace`: el aviso sustituye en su sitio al visible del mismo grupo (si lo hay) en lugar de apilarse, p. ej. mover una
 * columna con Alt+flechas pulsación tras pulsación. Se vuelve a anunciar (es un aviso nuevo en el mismo hueco).
 */
interface ToastOptions {
  replace?: string;
}
type ShowToast = (message: string, kind?: ToastKind, action?: ToastAction, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

/** El aviso de sesión caducada se queda más tiempo: es lo único que lleva a volver a entrar sin perder lo escrito. */
const SESSION_TOAST_MS = 30000;

export { isSessionExpiredMessage };

/**
 * A la pantalla de acceso, con vuelta a la página actual (`next`). Navegación completa a propósito: al salir de la página
 * se guardan los borradores (título, descripción, tarea nueva… ver useDraftAutosave, que guarda en «pagehide») y, al
 * volver a entrar, la tarea se reabre con lo escrito. Nunca se hace sola: solo al pulsar el botón del aviso.
 */
function goToLogin(): void {
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

/** Tras sacar el ratón de la pila, lo que caducó mientras estaba encima se va con este margen (no de golpe). */
const AFTER_HOVER_MS = 1500;

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
  // Con el ratón encima de la pila no se cierra ni se recoloca nada (se iba el aviso que se estaba por pulsar, o se movía
  // bajo el ratón): lo que caduca entretanto espera en `expired` y lo nuevo no echa a los antiguos hasta salir.
  const hoveredRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const expired = useRef(new Set<number>());
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expire = useCallback((id: number) => {
    if (hoveredRef.current) {
      expired.current.add(id);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const pinnedId = () => sessionToast.current?.id ?? null;
  const onEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    hoveredRef.current = true;
    setHovered(true);
  };
  const onLeave = () => {
    hoveredRef.current = false;
    setHovered(false);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      if (hoveredRef.current) return;
      const gone = expired.current;
      expired.current = new Set();
      setItems((prev) => trimToasts(prev.filter((x) => !gone.has(x.id)), pinnedId()));
    }, AFTER_HOVER_MS);
  };
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);
  const show = useCallback<ShowToast>((message, kind = "success", action, options) => {
    // Sesión caducada a mitad de trabajo (cualquier acción, 401): el aviso lleva «Iniciar sesión» (en lugar del botón que
    // trajera, que sin sesión tampoco serviría), que abre la pantalla de acceso con vuelta a esta página. No se redirige
    // sin avisar: se perdería lo que se está escribiendo sin guardar.
    const t = tRef.current;
    // Con el ratón encima, lo nuevo se añade sin echar a nadie (se recorta al salir).
    const max = hoveredRef.current ? Infinity : MAX_TOASTS;
    if (kind === "error" && isSessionExpiredMessage(message, t)) {
      const hide = (id: number) => setTimeout(() => {
        expire(id);
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
      // Con el texto en el idioma de la interfaz: el servidor, sin sesión, lo manda en el de la instalación.
      setItems((prev) => placeToast(prev, { id, kind, pinned: true, message: t(SESSION_EXPIRED), action: { label: t("Iniciar sesión"), onClick: goToLogin, independent: true } }, id, max));
      return;
    }
    // Un aviso idéntico al anterior (mismo texto y tipo) y reciente no se repite: varias acciones seguidas con el mismo
    // resultado (o un doble clic) no apilan avisos iguales. Los que traen botón sí se muestran.
    const now = Date.now();
    if (!action && last.current && last.current.message === message && last.current.kind === kind && now - last.current.at < 2000) {
      // Se descarta el duplicado, pero el aviso visible vuelve a contar su tiempo.
      const cur = last.current;
      clearTimeout(cur.timer);
      cur.timer = setTimeout(() => expire(cur.id), cur.ms);
      return;
    }
    const id = nextId++;
    const ms = toastMs(kind, !!action);
    const timer = setTimeout(() => expire(id), ms);
    last.current = { message, kind, at: now, id, timer, ms };
    // Con muchos avisos seguidos se van los más antiguos, nunca el de sesión caducada (su temporizador sigue en marcha
    // y, si se quitara, durante 30 s no habría forma de volver a entrar).
    const pinned = sessionToast.current?.id ?? null;
    setItems((prev) => placeToast(prev, { id, kind, message, action, group: options?.replace }, pinned, max));
  }, [expire]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* En escritorio, arriba. En móvil, abajo (arriba tapaban la cabecera: menú, proyecto, deshacer/rehacer): por encima
          de los botones flotantes de crear (hasta 8,25rem del pie), de la barra de selección (`--selection-bar-space`,
          SelectionBar) y del aviso «Sin conexión» (`--connection-notice-space`, ConnectionNotice), con el más reciente
          abajo y solo los dos últimos a la vista (más el de sesión caducada, que no se oculta nunca). */}
      <div
        data-toasts=""
        // Solo con ratón: en una pantalla táctil no hay «salir», y los avisos no se irían nunca.
        onPointerEnter={(e) => e.pointerType === "mouse" && onEnter()}
        onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
        className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4 max-md:top-auto max-md:bottom-[calc(env(safe-area-inset-bottom)+max(9rem,1rem+var(--selection-bar-space,0px))+var(--connection-notice-space,0px))] max-md:[&>:not([data-pinned]):nth-last-child(n+3)]:hidden"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            data-pinned={item.pinned ? "" : undefined}
            // La región ya es «polite»; los errores se anuncian al momento.
            role={item.kind === "error" ? "alert" : undefined}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg",
              item.kind === "error" ? "bg-red-600" : "bg-slate-900 dark:bg-slate-700",
            )}
          >
            {item.kind === "error" ? <AlertCircle size={16} className="shrink-0" /> : item.kind === "undo" ? <Undo2 size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
            <span><MessageWithLinks message={item.message} /></span>
            {/* «Deshacer» anulado por uno posterior: con el ratón encima sigue en su sitio (nada se mueve bajo el ratón),
                apagado y explicando por qué; al salir, desaparece. */}
            {item.action && item.stale && hovered && (
              <button
                type="button"
                aria-disabled
                title={t("Solo se puede deshacer el último cambio: usa la flecha ↶ de arriba.")}
                className="ml-1 shrink-0 cursor-not-allowed rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300 opacity-50"
                onClick={() => show(t("Solo se puede deshacer el último cambio: usa la flecha ↶ de arriba."), "error")}
              >
                {item.action.label}
              </button>
            )}
            {item.action && !item.stale && (
              <button
                type="button"
                className="ml-1 shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                onClick={() => {
                  setItems((prev) => prev.filter((x) => x.id !== item.id));
                  if (sessionToast.current?.id === item.id) {
                    clearTimeout(sessionToast.current.timer);
                    sessionToast.current = null;
                  }
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
