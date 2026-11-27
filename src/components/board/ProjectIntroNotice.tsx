"use client";

import { Info, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { OPEN_PEOPLE_COLUMNS_EVENT } from "./NewColumnButton";

/**
 * Descripciones por enseñar, por proyecto: «Nuevo proyecto» (AppShell) apunta aquí la del que acaba de crear desde una
 * plantilla y el tablero la recoge al abrirse (useProjectIntro). En memoria de la página: al recargar ya no sale.
 * Antes iba en la dirección (`?nuevo=1`), y quitar el parámetro hacía que el primer refresco del tablero (crear una columna,
 * un cambio en vivo) lo montara de nuevo: el aviso desaparecía solo y el tablero volvía al principio.
 */
const pendingIntro = new Map<string, string>();

/** Enseña una vez la descripción del proyecto encima de sus columnas cuando se abra su tablero. */
export function showProjectIntroOnce(projectId: string, description: string): void {
  if (description.trim()) pendingIntro.set(projectId, description.trim());
}

/** La descripción por enseñar del proyecto (o ""): se lee al montar el tablero y se olvida, así sale una sola vez. */
export function useProjectIntro(projectId: string): string {
  const [text] = useState(() => pendingIntro.get(projectId) ?? "");
  useEffect(() => {
    pendingIntro.delete(projectId);
  }, [projectId]);
  return text;
}

/**
 * Descripción del proyecto encima de las columnas, en la primera visita tras crearlo desde una plantilla (antes solo se veía
 * en Ajustes del proyecto). Sin base de datos: es un aviso de una sola vez, que se cierra con su X.
 */
export function ProjectIntroNotice({ description, byPeople }: { description: string; byPeople?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  if (!open || !description.trim()) return null;
  return (
    <div
      role="note"
      aria-label={t("Descripción del proyecto")}
      data-project-intro
      className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-slate-700 md:mx-4 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-slate-200"
    >
      <Info size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line">{description.trim()}</p>
        {byPeople && (
          <button type="button" className="mt-1.5 flex items-center gap-1.5 text-left text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => window.dispatchEvent(new Event(OPEN_PEOPLE_COLUMNS_EVENT))}>
            <Users size={15} aria-hidden className="shrink-0" /> {t("Organizar por personas: una columna para cada una")}
          </button>
        )}
      </div>
      <button type="button" className="btn-icon -my-1 -mr-1 h-7 w-7 shrink-0" onClick={() => setOpen(false)} aria-label={t("Cerrar")} title={t("Cerrar")}>
        <X size={15} />
      </button>
    </div>
  );
}
