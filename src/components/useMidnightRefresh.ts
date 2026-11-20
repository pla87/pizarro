"use client";

import { useEffect } from "react";
import { midnightStep, msUntilNextDay, todayIso } from "@/lib/dates";
import { appTimeZone } from "@/lib/format";
import { useSafeRefresh } from "./useSafeRefresh";

/**
 * «Hoy» (`today`, del servidor: plazos, «vence hoy», «Vencidas», el día marcado) cambia a medianoche en la zona de la app
 * aunque la página siga abierta: al empezar el día siguiente se llama a `refresh`. Sin estado: el temporizador no vuelve a
 * dibujar nada hasta que llegan los datos nuevos (con otro `today`, que reinicia la espera). Si al abrir el día del
 * navegador ya es distinto (reloj del equipo desajustado), no se refresca en bucle.
 */
export function useMidnightRefresh(today: string, refresh: () => void): void {
  useEffect(() => {
    const tz = appTimeZone();
    if (todayIso(tz) !== today) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const check = () => {
      const step = midnightStep(todayIso(tz), today, retries, msUntilNextDay(tz));
      if (!step) return;
      if (step.refresh) {
        retries++;
        refresh();
      }
      timer = setTimeout(check, step.waitMs);
    };
    check();
    return () => clearTimeout(timer);
  }, [today, refresh]);
}

/** Para las páginas de servidor (Mis tareas): refresca la página al cambiar el día. No pinta nada. */
export function MidnightRefresh({ today }: { today: string }): null {
  useMidnightRefresh(today, useSafeRefresh());
  return null;
}
