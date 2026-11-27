"use client";

import { useSyncExternalStore } from "react";

/**
 * ¿Tiene sentido enseñar «Releases» en el menú del proyecto? Solo si tiene una columna con el rol «Siguiente salto» o ya
 * alguna release. El tablero (que ya tiene las columnas) lo apunta aquí por proyecto y el menú lo lee; sin dato
 * (todavía no se ha abierto el tablero) se enseña, como siempre.
 */
const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Apunta si el proyecto usa releases (lo llama el tablero y el layout al cargar la página). */
export function setReleaseNav(projectId: string, show: boolean): void {
  if (known.get(projectId) === show) return;
  known.set(projectId, show);
  for (const l of listeners) l();
}

/** `initial`: lo que trajo el servidor al cargar la página (vale hasta que el tablero apunte otra cosa). */
export function useReleaseNav(projectId: string, initial: boolean | undefined): boolean {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => known.get(projectId),
    () => undefined,
  );
  return value ?? initial ?? true;
}
