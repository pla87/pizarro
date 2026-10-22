"use client";

import { useEffect } from "react";

type BadgingNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Número de avisos sin leer en el icono de la app instalada (Badging API; sin efecto donde no existe). */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as BadgingNavigator;
    if (typeof nav.setAppBadge !== "function") return;
    // El navegador puede rechazarlo (p. ej. sin permiso de notificaciones en algunos sistemas): no es un error de la app.
    const apply = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.();
    apply?.catch(() => {});
  }, [count]);
  return null;
}
