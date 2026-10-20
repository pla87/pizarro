"use client";

import { useT } from "@/i18n/client";
import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";

export function KindsAdmin({ kinds }: { kinds: KindRow[] }) {
  const t = useT();
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t("Tipos de tarea generales")}</h2>
        <p className="text-sm text-slate-500">
          {t("Disponibles en todos los proyectos. Cada tipo es una sección de las release notes, en este orden; los tipos propios de un proyecto se gestionan en sus ajustes y van detrás.")}
        </p>
      </div>
      <KindsManager kinds={kinds} />
    </div>
  );
}
