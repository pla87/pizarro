"use client";

import { useState } from "react";
import { setProjectShareOut } from "@/actions/share-out";
import { countProjectShareLinks } from "@/actions/share-out-count";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Ajustes del proyecto → Tablero (solo administradores): activar «Compartir fuera». Apagada por defecto. Al apagarla,
 * todos los enlaces del proyecto dejan de funcionar al momento y la opción deja de salir en el menú de las columnas
 * (se pide confirmación si el servidor dice que hay enlaces activos; el aviso dice cuántos han dejado de funcionar).
 */
export function ShareOutSettings({ projectId, enabled: initial }: { projectId: string; enabled: boolean }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useActionTransition();

  const change = async (on: boolean) => {
    let links: number | null = null;
    if (!on) {
      // Los que funcionan ahora, preguntados al servidor al pulsar: el recuento de cuando se cargó la página puede ser viejo
      // (otra pestaña ha generado una web) y antes apagaba sin preguntar. Si no se puede saber, se pregunta igual.
      setAsking(true);
      const count = await countProjectShareLinks(projectId).catch(() => null);
      setAsking(false);
      links = count?.ok ? count.data : null;
      if (links !== 0) {
        const ok = await confirm({
          title: t("Apagar «Compartir fuera»"),
          message: links === null
            ? t("Los enlaces activos del proyecto dejarán de funcionar al momento. ¿Apagarlo?")
            : links === 1 ? t("Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?") : t("Hay {n} enlaces activos: dejarán de funcionar al momento. ¿Apagarlo?", { n: links }),
          confirmLabel: t("Apagar"),
          danger: true,
        });
        if (!ok) return;
      }
    }
    start(async () => {
      const res = await setProjectShareOut(projectId, on);
      if (!res.ok) return toast(res.error, "error");
      setEnabled(on);
      // Cuántos han dejado de funcionar: los que revoca el servidor, sin contar los que ya habían caducado (también los
      // marca como revocados) si se sabe cuántos funcionaban justo antes.
      const revoked = links === null ? res.data.revoked : Math.min(links, res.data.revoked);
      toast(
        on
          ? t("«Compartir fuera» activado")
          : revoked === 0
            ? t("«Compartir fuera» apagado")
            : revoked === 1
              ? t("«Compartir fuera» apagado: 1 enlace ha dejado de funcionar")
              : t("«Compartir fuera» apagado: {n} enlaces han dejado de funcionar", { n: revoked }),
      );
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={enabled} disabled={pending || asking} onChange={(e) => void change(e.target.checked)} data-testid="share-out-toggle" />
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
