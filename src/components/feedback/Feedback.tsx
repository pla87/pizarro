"use client";

import { Bug } from "lucide-react";
import { createContext, useCallback, useContext, useId, useMemo, useState } from "react";
import { I18nContext } from "@/i18n/context";
import { useT } from "@/i18n/client";
import type { FeedbackStatus } from "@/lib/feedback-core";
import { updateDocsUrl } from "@/lib/update-check-core";
import { lazyDialog } from "../lazyDialog";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";

// El diálogo (y la librería de captura, que carga él al marcar la casilla) no va en el código común de la app.
const FeedbackDialog = lazyDialog(() => import("./FeedbackDialog"), (m) => m.FeedbackDialog);

interface FeedbackContextValue {
  /** null: esta instalación no es una build oficial sin modificar (no hay botón). */
  status: FeedbackStatus | null;
  /** Abre el diálogo, o, si hay que actualizar antes, lo explica en un aviso (al administrador, con «Cómo actualizar»). */
  request: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue>({ status: null, request: () => {} });

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
  const request = useCallback(() => {
    if (!status) return;
    if (status.outdated) {
      toast(
        t("Actualiza a la última versión para informar de un error o enviar una sugerencia"),
        "error",
        isAdmin ? { label: t("Cómo actualizar"), onClick: () => window.open(updateDocsUrl(locale), "_blank", "noopener,noreferrer") } : undefined,
      );
      return;
    }
    beforeOpen?.();
    setOpen(true);
  }, [status, isAdmin, locale, beforeOpen, toast, t]);
  const value = useMemo(() => ({ status, request }), [status, request]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {open && status && <FeedbackDialog delivery={status.delivery} version={version} email={email} onClose={() => setOpen(false)} />}
    </FeedbackContext.Provider>
  );
}

/** Texto del botón y de su aviso cuando está desactivado. */
function useFeedbackLabels() {
  const t = useT();
  return {
    label: t("Informar de un error o enviar una sugerencia"),
    outdated: t("Actualiza a la última versión para informar de un error o enviar una sugerencia"),
  };
}

/** Botón de icono del pie del menú lateral (también en el móvil), al lado de «Cerrar sesión». */
export function FeedbackButton() {
  const { status, request } = useFeedback();
  const { label, outdated } = useFeedbackLabels();
  const why = useId();
  if (!status) return null;
  // aria-disabled (no disabled): sigue enfocable y al pulsarlo explica por qué no se puede (en el móvil no hay tooltip).
  return (
    <button
      type="button"
      className={cn("btn-icon", status.outdated && "cursor-not-allowed opacity-50")}
      title={status.outdated ? outdated : label}
      aria-label={label}
      aria-disabled={status.outdated || undefined}
      aria-describedby={status.outdated ? why : undefined}
      data-feedback-button=""
      onClick={request}
    >
      <Bug size={17} />
      {status.outdated && <span id={why} className="sr-only">{outdated}</span>}
    </button>
  );
}

/** El mismo, con texto (Historial de versiones). */
export function FeedbackTextButton({ children }: { children: React.ReactNode }) {
  const { status, request } = useFeedback();
  const { outdated } = useFeedbackLabels();
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
