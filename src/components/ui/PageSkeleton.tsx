/** Esqueleto de una página de contenido (ajustes, listados…) mientras carga. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-4 md:p-6" aria-busy="true" aria-label="Cargando">
      <div className="h-7 w-48 rounded-lg bg-slate-200/70 dark:bg-slate-800/70" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-32 rounded-xl bg-slate-200/60 dark:bg-slate-800/60" />
      ))}
    </div>
  );
}
