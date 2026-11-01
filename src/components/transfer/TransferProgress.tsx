"use client";

import { Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { percent, type TransferJobView } from "./client";

/** Texto de la fase en la que va el trabajo (con «N de M» cuando se conoce). */
export function usePhaseLabel() {
  const t = useT();
  return (job: TransferJobView): string => {
    if (job.status === "QUEUED") return job.ahead > 0 ? t("En cola ({n} por delante)…", { n: job.ahead }) : t("En cola…");
    const { phase, done, total } = job.progress;
    const counted = total && done !== undefined ? { done: Math.min(done, total), total } : null;
    switch (phase) {
      case "datos": return t("Reuniendo los datos del proyecto…");
      case "archivos": return counted ? t("Archivos {done} de {total}", counted) : t("Archivos…");
      case "comprimir": return t("Cerrando el archivo…");
      case "validar": return counted ? t("Validando el archivo ({done} de {total})", counted) : t("Validando el archivo…");
      case "base de datos": return t("Guardando en la base de datos…");
      default: return t("Preparando…");
    }
  };
}

/** Barra y fase de un trabajo en cola o en marcha (role=progressbar; sin cifra si no se conoce el total). */
export function TransferProgress({ job }: { job: TransferJobView }) {
  const t = useT();
  const label = usePhaseLabel()(job);
  const pct = job.status === "RUNNING" ? percent(job.progress) : null;
  return (
    <div className="space-y-2" data-testid="transfer-progress">
      <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 size={15} className="animate-spin" /> <span data-testid="transfer-phase">{label}</span>
      </p>
      <div
        role="progressbar" aria-label={t("Progreso")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
        className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
      >
        <div className={`h-full bg-brand-600 transition-[width] ${pct === null ? "w-1/3 animate-pulse" : ""}`} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  );
}
