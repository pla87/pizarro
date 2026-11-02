"use client";

import { Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import type { BatchProgress } from "./upload";

/** Avance de una tanda de subidas: «Subiendo 5 de 32», barra y los archivos que van ahora mismo. */
export function UploadProgress({ progress, className }: { progress: BatchProgress; className?: string }) {
  const t = useT();
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className={className} role="status" data-testid="upload-progress">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
        <Loader2 size={14} className="animate-spin" />
        {t("Subidos {done} de {total}", { done: progress.done, total: progress.total })}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
        <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {progress.active.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
          {progress.active.map((name, i) => (
            <li key={`${i}-${name}`} className="flex items-center gap-1 truncate" title={name}>
              <Loader2 size={11} className="shrink-0 animate-spin" /> <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
