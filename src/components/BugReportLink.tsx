"use client";

import { Info } from "lucide-react";
import { useT } from "@/i18n/client";
import { FeedbackTextButton, useFeedback } from "./feedback/Feedback";

/**
 * «Informar de un error» (Historial de versiones): abre el mismo diálogo que el botón del pie del menú (ver
 * feedback/Feedback.tsx). Solo en builds oficiales sin modificar; en las demás, la nota de siempre.
 */
export function BugReportLink() {
  const t = useT();
  const { status } = useFeedback();
  if (!status) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        {t("Los informes de errores solo se atienden en versiones oficiales sin modificar, y esta instalación no usa una.")}
      </p>
    );
  }
  return <FeedbackTextButton>{t("Informar de un error")}</FeedbackTextButton>;
}
