"use client";

import { useTransition } from "react";
import { cancelSecondStep } from "@/actions/two-factor";
import { useT } from "@/i18n/client";

/** «Volver» del segundo paso: descarta el estado pendiente y vuelve al acceso con una recarga completa (ver cancelSecondStep). */
export function BackToLogin({ className = "text-slate-500 hover:underline" }: { className?: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await cancelSecondStep().catch(() => {});
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa a propósito: el idioma del layout raíz debe cambiar
          window.location.assign("/login");
        })
      }
    >
      {t("Volver")}
    </button>
  );
}
