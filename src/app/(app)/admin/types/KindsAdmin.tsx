"use client";

import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";

export function KindsAdmin({ kinds }: { kinds: KindRow[] }) {
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Tipos de tarea generales</h1>
        <p className="text-sm text-slate-500">
          Disponibles en todos los proyectos. Cada tipo es una sección de las release notes, en este orden; los tipos propios de un proyecto se gestionan en sus ajustes y van detrás.
        </p>
      </div>
      <KindsManager kinds={kinds} />
    </div>
  );
}
