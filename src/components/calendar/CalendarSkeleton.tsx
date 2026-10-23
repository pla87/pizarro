"use client";

import { useT } from "@/i18n/client";

/** Esqueleto del calendario mientras carga el mes. */
export function CalendarSkeleton() {
  const t = useT();
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-4 p-4 md:p-6" aria-busy="true" aria-label={t("Cargando")}>
      <div className="h-7 w-56 rounded-lg bg-slate-200/70 dark:bg-slate-800/70" />
      <div className="h-9 w-full rounded-lg bg-slate-200/60 dark:bg-slate-800/60" />
      <div className="hidden h-[32rem] rounded-xl bg-slate-200/60 md:block dark:bg-slate-800/60" />
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
        ))}
      </div>
    </div>
  );
}
