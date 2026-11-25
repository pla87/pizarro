"use client";

import { useState } from "react";
import { setProjectShareOut } from "@/actions/share-out";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Ajustes del proyecto → Tablero (solo administradores): activar «Compartir fuera». Apagada por defecto. Al apagarla,
 * todos los enlaces del proyecto dejan de funcionar al momento y la opción deja de salir en el menú de las columnas
 * (se pide confirmación si hay enlaces activos).
 */
export function ShareOutSettings({ projectId, enabled: initial, activeLinks }: { projectId: string; enabled: boolean; activeLinks: number }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useActionTransition();

  const change = async (on: boolean) => {
    if (!on && activeLinks > 0) {
      const ok = await confirm({
        title: t("Apagar «Compartir fuera»"),
        message: activeLinks === 1 ? t("Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?") : t("Hay {n} enlaces activos: dejarán de funcionar al momento. ¿Apagarlo?", { n: activeLinks }),
        confirmLabel: t("Apagar"),
        danger: true,
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await setProjectShareOut(projectId, on);
      if (!res.ok) return toast(res.error, "error");
      setEnabled(on);
      toast(on ? t("«Compartir fuera» activado") : t("«Compartir fuera» apagado"));
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={enabled} disabled={pending} onChange={(e) => void change(e.target.checked)} data-testid="share-out-toggle" />
        <span>
          <span className="font-medium">{t("Permitir columnas «Compartir fuera»")}</span>
          <span className="block text-slate-600 dark:text-slate-400">
            {t("Una columna con el rol «Compartir fuera» publica sus tareas en una web sin cuenta para alguien de fuera (un proveedor, un cliente), que puede verlas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos.")}
          </span>
        </span>
      </label>
      <p className="text-xs text-slate-500">{t("Al apagarlo, todos los enlaces del proyecto dejan de funcionar al momento.")}</p>
    </div>
  );
}
