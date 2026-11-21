"use client";

import { Copy, RotateCcw } from "lucide-react";
import { useT } from "@/i18n/client";
import { copyText } from "./clipboard";
import { useToast } from "./Toast";

/**
 * Aviso de un formulario de Administración que no se ha guardado porque otra persona cambió lo mismo mientras tanto
 * (ver edit-conflict-core.ts). Lo escrito sigue en el formulario: se puede copiar antes de recargar, que trae lo que
 * guardó la otra persona.
 */
export function EditConflictNotice({ draft, onReload }: { draft?: string; onReload?: () => void }) {
  const t = useT();
  const toast = useToast();
  return (
    <div role="alert" data-testid="edit-conflict" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
      <p>
        <strong className="font-semibold">{t("Otra persona ha cambiado esto mientras lo editabas.")}</strong>{" "}
        {draft !== undefined
          ? t("No se ha guardado, para no pisar su cambio. Lo que has escrito sigue aquí: cópialo si lo quieres conservar y recarga para ver lo guardado.")
          : t("No se ha guardado, para no pisar su cambio. Lo que has cambiado sigue aquí a la vista: al recargar verás lo que guardó la otra persona y podrás repetir tus cambios.")}
      </p>
      <div className="flex flex-wrap gap-2">
        {draft !== undefined && (
          <button type="button" className="btn-secondary py-1" onClick={() => void copyText(draft).then((ok) => toast(ok ? t("Copiado al portapapeles") : t("No se ha podido copiar al portapapeles."), ok ? "success" : "error"))}>
            <Copy size={14} /> {t("Copiar lo que has escrito")}
          </button>
        )}
        <button type="button" className="btn-secondary py-1" onClick={onReload ?? (() => window.location.reload())}>
          <RotateCcw size={14} /> {t("Recargar")}
        </button>
      </div>
    </div>
  );
}
