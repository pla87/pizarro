"use client";

import { Bug } from "lucide-react";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I18nContext } from "@/i18n/context";
import { useT } from "@/i18n/client";
import type { FeedbackStatus } from "@/lib/feedback-core";
import { updateDocsUrl } from "@/lib/update-check-core";
import { lazyDialog } from "../lazyDialog";
import { cn } from "../ui/cn";
import { useAnyModalOpen } from "../ui/Modal";
import { useFloatingRect } from "../ui/useFloatingRect";
import { useToast } from "../ui/Toast";

// El diálogo (y la librería de captura, que carga él al marcar la casilla) no va en el código común de la app.
const FeedbackDialog = lazyDialog(() => import("./FeedbackDialog"), (m) => m.FeedbackDialog);

interface FeedbackContextValue {
  /** null: esta instalación no es una build oficial sin modificar (no hay botón). */
  status: FeedbackStatus | null;
  /** Abre el diálogo, o, si hay que actualizar antes, lo explica en un aviso (al administrador, con «Cómo actualizar»). */
  request: () => void;
  /** Por qué está desactivado si hay una versión más nueva: quien no administra no puede actualizar, se lo pide a quien sí. */
  outdatedText: string;
  /** El diálogo de informar está abierto (entonces el botón no se copia encima de su fondo). */
  open: boolean;
}

const FeedbackContext = createContext<FeedbackContextValue>({ status: null, request: () => {}, outdatedText: "", open: false });

export const useFeedback = () => useContext(FeedbackContext);

/**
 * «Informar de un error o enviar una sugerencia»: un solo diálogo para el botón del pie del menú (junto a «Cerrar
 * sesión») y el de Historial de versiones. Vive fuera del menú lateral porque en el móvil el menú se cierra al abrirlo
 * (`beforeOpen`): la captura debe ser de la página, no del menú.
 */
export function FeedbackProvider({ status, isAdmin, version, email, beforeOpen, children }: {
  status: FeedbackStatus | null;
  isAdmin: boolean;
  version: string;
  email: string;
  beforeOpen?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const { locale } = useContext(I18nContext);
  const [open, setOpen] = useState(false);
  const outdatedText = isAdmin
    ? t("Actualiza a la última versión para informar de un error o enviar una sugerencia")
    : t("Esta instalación no tiene la última versión de Pizarro: pide a quien la administra que la actualice para poder informar de un error o enviar una sugerencia.");
  const request = useCallback(() => {
    if (!status) return;
    if (status.outdated) {
      toast(
        outdatedText,
        "error",
        isAdmin ? { label: t("Cómo actualizar"), onClick: () => window.open(updateDocsUrl(locale), "_blank", "noopener,noreferrer") } : undefined,
      );
      return;
    }
    beforeOpen?.();
    setOpen(true);
  }, [status, isAdmin, outdatedText, locale, beforeOpen, toast, t]);
  const value = useMemo(() => ({ status, request, outdatedText, open }), [status, request, outdatedText, open]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {open && status && <FeedbackDialog githubReason={status.githubReason} version={version} email={email} onClose={() => setOpen(false)} />}
    </FeedbackContext.Provider>
  );
}

/** Botón de icono del pie del menú lateral (también en el móvil), al lado de «Cerrar sesión». */
export function FeedbackButton() {
  const t = useT();
  const { status, request, outdatedText: outdated, open } = useFeedback();
  const label = t("Informar de un error o enviar una sugerencia");
  const why = useId();
  const ref = useRef<HTMLButtonElement>(null);
  // Con un diálogo abierto, el menú lateral queda bajo su fondo difuminado: como Deshacer/Rehacer, se dibuja una copia
  // encima, en el mismo sitio (solo escritorio y si ningún panel cae encima: useFloatingRect). Con el propio diálogo de
  // informar abierto no hace falta.
  const modalOpen = useAnyModalOpen();
  const rect = useFloatingRect(ref, !!status && modalOpen && !open);
  if (!status) return null;
  const props = {
    type: "button" as const,
    title: status.outdated ? outdated : label,
    "aria-label": label,
    "aria-disabled": status.outdated || undefined,
    "aria-describedby": status.outdated ? why : undefined,
    onClick: request,
  };
  const look = status.outdated && "cursor-not-allowed opacity-50";
  // aria-disabled (no disabled): sigue enfocable y al pulsarlo explica por qué no se puede (en el móvil no hay tooltip).
  return (
    <>
      <button ref={ref} {...props} className={cn("btn-icon", look)} data-feedback-button="">
        <Bug size={17} />
        {status.outdated && <span id={why} className="sr-only">{outdated}</span>}
      </button>
      {rect &&
        createPortal(
          <button
            {...props}
            tabIndex={-1}
            // Fuera del `inert` del modal (Modal.tsx) y por encima de su fondo; no sale en la captura del informe.
            data-pz-layer=""
            data-pz-no-capture=""
            data-feedback-copy=""
            className={cn("btn-icon fixed z-[70] bg-white shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700", look)}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            <Bug size={17} />
          </button>,
          document.body,
        )}
    </>
  );
}

/** El mismo, con texto (Historial de versiones). */
export function FeedbackTextButton({ children }: { children: React.ReactNode }) {
  const { status, request, outdatedText: outdated } = useFeedback();
  const why = useId();
  if (!status) return null;
  // La explicación va fuera del botón: dentro, sin aria-label, formaría parte de su nombre.
  return (
    <>
      <button
        type="button"
        className={cn("btn-secondary w-fit py-1.5", status.outdated && "cursor-not-allowed opacity-50")}
        title={status.outdated ? outdated : undefined}
        aria-disabled={status.outdated || undefined}
        aria-describedby={status.outdated ? why : undefined}
        onClick={request}
      >
        <Bug size={15} /> {children}
      </button>
      {status.outdated && <span id={why} className="sr-only">{outdated}</span>}
    </>
  );
}
