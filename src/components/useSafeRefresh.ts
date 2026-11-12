"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { safeRefresh } from "@/lib/connection";

/**
 * `router.refresh()` que no deja la página en blanco sin red: si el servidor no responde, el refresco queda pendiente
 * hasta que vuelva la conexión (ver lib/connection.ts). Úsalo en lugar de `router.refresh()`.
 */
export function useSafeRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => void safeRefresh(() => router.refresh(), router), [router]);
}
