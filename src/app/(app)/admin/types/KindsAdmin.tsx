"use client";

import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";

export function KindsAdmin({ kinds }: { kinds: KindRow[] }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Tipos de tarea generales</h2>
        <p className="text-sm text-slate-500">
          Disponibles en todos los proyectos. Cada tipo es una sección de las release notes, en este orden; los tipos propios de un proyecto se gestionan en sus ajustes y van detrás.
        </p>
      </div>
      <KindsManager kinds={kinds} />
    </div>
  );
}
