"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/components/ui/cn";

/** Las cargas más rápidas que esto no enseñan nada (ni lo anuncia el lector de pantalla): así no parpadea. */
const SHOW_AFTER_MS = 200;

/**
 * Marco común de los esqueletos de las páginas de proyecto (loading.tsx del tablero, Releases, Documentación y Ajustes):
 * ocupa el hueco de la página (la barra lateral se queda), aparece a los 200 ms (CSS, así que también antes de hidratar)
 * y entonces anuncia «Cargando…». Brillo y retardo: `.project-skeleton` y `.sk` en globals.css (sin brillo con
 * movimiento reducido).
 */
function SkeletonFrame({ kind, className, children }: { kind: "board" | "releases" | "docs" | "settings"; className?: string; children: React.ReactNode }) {
  const t = useT();
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setAnnounce(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className={cn("project-skeleton", className)} data-project-loading={kind} aria-busy="true">
      <div aria-hidden className="contents">{children}</div>
      {/* Región viva vacía al montar: el texto llega después y así el lector de pantalla lo anuncia. */}
      <p role="status" className="sr-only">{announce ? t("Cargando…") : ""}</p>
    </div>
  );
}

/** Un «hueso» del esqueleto: bloque redondeado con el brillo (el tamaño y la forma, en `className`). */
function Bone({ className }: { className?: string }) {
  return <span className={cn("sk block rounded", className)} />;
}

/** Forma de cada columna: ancho del título y tarjetas (con 1-2 líneas cada una). Fijo: no cambia entre cargas. */
const COLUMNS: { title: string; count: string; cards: (1 | 2)[] }[] = [
  { title: "w-20", count: "w-5", cards: [2, 1, 2] },
  { title: "w-28", count: "w-4", cards: [1, 2] },
  { title: "w-36", count: "w-5", cards: [2, 2, 1, 2] },
  { title: "w-16", count: "w-4", cards: [1] },
];
/** Ancho de la segunda línea de las tarjetas, por turnos. */
const LINE2 = ["w-3/5", "w-2/5", "w-1/2", "w-3/4"];

/**
 * Esqueleto del tablero: la cabecera (nombre, buscador y botones; en tableta y móvil, su barra), cuatro columnas con la
 * forma de su cabecera (título, contador, «+» y menú) y unas tarjetas que se desvanecen hacia abajo. En móvil, una sola
 * columna y las pestañas de columnas, como el tablero real.
 */
export function BoardSkeleton() {
  return (
    <SkeletonFrame kind="board" className="flex h-full flex-col">
      {/* Escritorio: la cabecera del tablero (Board.tsx). */}
      <div data-skeleton-header className="flex items-center gap-3 px-4 pt-4 pb-2 max-lg:hidden">
        <Bone className="h-6 w-44 rounded-md" />
        <Bone className="h-4 w-14" />
        <Bone className="ml-auto h-8 w-36 rounded-lg" />
        <Bone className="h-8 w-8 rounded-md" />
        <Bone className="h-8 w-8 rounded-md" />
        <Bone className="h-8 w-28 rounded-lg" />
        <Bone className="h-8 w-28 rounded-lg" />
        <span className="sk sk-brand block h-8 w-32 rounded-lg" />
      </div>
      {/* Tableta: la barra del buscador. */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 max-md:hidden lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <Bone className="h-8 flex-1 rounded-lg" />
        <Bone className="h-8 w-8 rounded-md" />
        <Bone className="h-8 w-8 rounded-md" />
        <Bone className="h-3.5 w-16" />
      </div>
      {/* Móvil: lupa, filtros, vista y las pestañas de columnas (la primera, la activa). */}
      <div data-skeleton-tabs className="flex items-center gap-1.5 overflow-hidden border-b border-slate-200 bg-white py-2 pl-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
        <Bone className="h-8 w-8 shrink-0 rounded-md" />
        <Bone className="h-8 w-8 shrink-0 rounded-md" />
        <Bone className="mr-1 h-8 w-8 shrink-0 rounded-md" />
        <span className="sk sk-brand block h-7 w-24 shrink-0 rounded-full" />
        {["w-20", "w-24", "w-16"].map((w) => <Bone key={w} className={cn("h-7 shrink-0 rounded-full", w)} />)}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-3 pt-2 pb-2 md:px-4 md:pb-4">
        {COLUMNS.map((col, i) => (
          <div
            key={i}
            data-skeleton-column
            className={cn("flex w-full shrink-0 flex-col rounded-xl bg-slate-100/80 md:w-auto md:min-w-72 md:flex-1 dark:bg-slate-900/60", i > 0 && "max-md:hidden")}
          >
            <div className="flex h-11 items-center gap-2 px-3 pt-1">
              <Bone className={cn("h-3.5", col.title)} />
              <Bone className={cn("h-4 rounded-full", col.count)} />
              <Bone className="ml-auto h-5 w-5 rounded-md" />
              <Bone className="h-5 w-5 rounded-md" />
            </div>
            <div className="sk-fade flex flex-col gap-2 px-2 pt-0.5">
              {col.cards.map((lines, j) => (
                <div key={j} className="space-y-2 rounded-lg border border-slate-200/70 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
                  <Bone className="h-3 w-11/12" />
                  {lines === 2 && <Bone className={cn("h-3", LINE2[(i + j) % LINE2.length])} />}
                  <div className="flex gap-1.5 pt-0.5">
                    <Bone className="h-3.5 w-12 rounded-full" />
                    {(i + j) % 2 === 0 && <Bone className="h-3.5 w-8 rounded-full" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* La barra «+» para añadir columnas, a la derecha. */}
        <div className="w-10 shrink-0 rounded-xl border-2 border-dashed border-slate-200 max-md:hidden dark:border-slate-800" />
      </div>
    </SkeletonFrame>
  );
}

/** Título y subtítulo de una página de contenido, con botones a la derecha si los lleva. */
function PageHead({ title, buttons = [] }: { title: string; buttons?: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <Bone className={cn("h-7 rounded-lg", title)} />
      {buttons.map((w, i) => (
        <span key={i} className={cn("sk block h-9 rounded-lg", w, i === 0 && "ml-auto", i === buttons.length - 1 && "sk-brand")} />
      ))}
    </div>
  );
}

/** Releases: título, buscador y las tarjetas de las últimas releases (título, fecha y unas líneas de notas). */
export function ReleasesSkeleton() {
  return (
    <SkeletonFrame kind="releases" className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHead title="w-32" />
      <Bone className="mt-2 mb-6 h-4 w-72 max-w-full" />
      <Bone className="mb-4 h-10 w-full rounded-lg" />
      <div className="sk-fade space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Bone className="h-5 w-12 rounded-md" />
              <Bone className={cn("h-5", ["w-56", "w-44", "w-64"][i])} />
              <Bone className="ml-auto h-4 w-24" />
            </div>
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-5/6" />
            {i !== 1 && <Bone className="h-3 w-2/3" />}
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/** Documentación: título con «Papelera» y «Subir», la nota y la lista de documentos (icono, nombre, datos y acciones). */
export function DocsSkeleton() {
  return (
    <SkeletonFrame kind="docs" className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHead title="w-44" buttons={["w-24", "w-32"]} />
      <Bone className="mt-2 mb-4 h-4 w-80 max-w-full" />
      <div className="card sk-fade divide-y divide-slate-200 dark:divide-slate-800">
        {["w-48", "w-36", "w-60", "w-40", "w-52"].map((w) => (
          <div key={w} className="flex items-center gap-3 px-3 py-2.5">
            <Bone className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bone className={cn("h-3.5 max-w-full", w)} />
              <Bone className="h-3 w-28" />
            </div>
            <Bone className="h-8 w-8 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/** Ajustes del proyecto: título con «Ir al tablero», las pestañas y dos tarjetas de campos. */
export function SettingsSkeleton() {
  return (
    <SkeletonFrame kind="settings" className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <PageHead title="w-56" buttons={["w-28"]} />
      <div className="flex gap-5 overflow-hidden border-b border-slate-200 px-1 pb-2.5 dark:border-slate-800">
        {["w-16", "w-24", "w-20", "w-28", "w-16"].map((w, i) => <Bone key={i} className={cn("h-4 shrink-0", w)} />)}
      </div>
      <div className="sk-fade space-y-5">
        {[3, 2].map((fields, i) => (
          <div key={i} className="card space-y-4 p-5">
            <Bone className="h-5 w-40" />
            {Array.from({ length: fields }).map((_, j) => (
              <div key={j} className="space-y-1.5">
                <Bone className="h-3 w-24" />
                <Bone className="h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
