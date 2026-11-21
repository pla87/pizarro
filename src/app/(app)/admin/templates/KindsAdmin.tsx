"use client";

import { InfoTip } from "@/components/ui/InfoTip";
import { useT } from "@/i18n/client";
import type { EditorModeValue } from "@/lib/types";
import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";

export function KindsAdmin({ kinds, editorMode }: { kinds: KindRow[]; editorMode: EditorModeValue }) {
  const t = useT();
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t("Tipos de tarea generales")}</h2>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          {t("Disponibles en todos los proyectos.")}
          <InfoTip topic={t("Tipos de tarea generales")}>{t("Cada tipo es una sección de las release notes, en este orden. Los tipos propios de cada proyecto se gestionan en sus ajustes y van detrás.")}</InfoTip>
        </p>
      </div>
      <KindsManager kinds={kinds} editorMode={editorMode} />
    </div>
  );
}
