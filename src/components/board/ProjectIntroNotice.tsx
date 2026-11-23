"use client";

import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { replaceUrlKeepingState } from "@/lib/replace-url";

/** Parámetro de la dirección con el que «Nuevo proyecto» abre el tablero de un proyecto recién creado desde una plantilla. */
export const NEW_PROJECT_PARAM = "nuevo";

/**
 * Descripción del proyecto encima de las columnas, en la primera visita tras crearlo desde una plantilla (antes solo se veía
 * en Ajustes del proyecto). Al montar se quita `?nuevo=1` de la dirección: al recargar (o al volver) ya no sale, y al
 * cerrarlo tampoco. Sin base de datos: es un aviso de una sola vez. El tablero guarda el texto al montar (Board): tras
 * quitar el parámetro, un refresco del tablero ya no lo trae y el aviso no debe desaparecer por eso.
 */
export function ProjectIntroNotice({ description }: { description: string }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(NEW_PROJECT_PARAM)) return;
    url.searchParams.delete(NEW_PROJECT_PARAM);
    replaceUrlKeepingState(url);
  }, []);
  if (!open || !description.trim()) return null;
  return (
    <div
      role="note"
      aria-label={t("Descripción del proyecto")}
      data-project-intro
      className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-slate-700 md:mx-4 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-slate-200"
    >
      <Info size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
      <p className="min-w-0 flex-1 whitespace-pre-line">{description.trim()}</p>
      <button type="button" className="btn-icon -my-1 -mr-1 h-7 w-7 shrink-0" onClick={() => setOpen(false)} aria-label={t("Cerrar")} title={t("Cerrar")}>
        <X size={15} />
      </button>
    </div>
  );
}
