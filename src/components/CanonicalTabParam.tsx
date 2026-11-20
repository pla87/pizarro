"use client";

import { useEffect } from "react";

/**
 * La página se abrió con otro nombre de una pestaña («?tab=board», «?tab=plantillas»): ya se pinta la buena, y aquí solo
 * se corrige la dirección a su id, sin recargar y conservando el resto de parámetros y el ancla (`#labels`). Un
 * redirect del servidor no ve el ancla y la perdía.
 */
export function CanonicalTabParam({ tab }: { tab: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === tab) return;
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [tab]);
  return null;
}
