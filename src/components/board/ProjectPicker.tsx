"use client";

import { Loader2 } from "lucide-react";
import { useContext } from "react";
import { useT } from "@/i18n/client";
import { ProjectsContext } from "../ProjectMenu";

/**
 * Selector de proyecto de la cabecera de los diálogos de creación (segundo diálogo de la pareja):
 * estrecho, con el nombre truncado y separado del título.
 */
export function ProjectPicker({ value, onChange, loading }: { value: string; onChange: (id: string) => void; loading: boolean }) {
  const t = useT();
  const { projects } = useContext(ProjectsContext);
  if (projects.length < 2) return null;
  return (
    <>
      <select
        aria-label={t("Proyecto")}
        title={t("Proyecto en el que se crea la tarea")}
        className="input ml-4 h-8 min-w-0 max-w-[12rem] flex-1 truncate py-0 text-sm font-normal sm:flex-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {loading && <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" aria-label={t("Cargando…")} />}
    </>
  );
}
