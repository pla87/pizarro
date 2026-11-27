"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * ¿Tiene sentido enseñar «Releases» en el menú del proyecto? Solo si tiene una columna con el rol «Siguiente salto» o ya
 * alguna release. El tablero (que ya tiene las columnas) lo apunta aquí por proyecto y el menú lo lee; sin dato
 * (todavía no se ha abierto el tablero) se enseña, como siempre.
 */
const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Apunta si el proyecto usa releases (lo llaman el tablero y, cuando cambia lo que trae el layout, el menú). */
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

/**
 * Lo que trae el layout del servidor (`releaseNav`), apuntado cuando cambia: tras un `router.refresh()` (p. ej. al aplicar
 * una plantilla en Ajustes) el menú no se queda con lo que apuntó el tablero antes. Al montar no se apunta: hasta que el
 * tablero diga algo vale como `initial` de useReleaseNav, y el tablero (que se monta antes) ya tiene sus columnas en vivo.
 */
export function useServerReleaseNav(nav: { id: string; show: boolean } | null): void {
  const id = nav?.id ?? null;
  const show = nav?.show ?? null;
  const last = useRef(`${id}:${show}`);
  useEffect(() => {
    const key = `${id}:${show}`;
    if (key === last.current) return;
    last.current = key;
    if (id !== null && show !== null) setReleaseNav(id, show);
  }, [id, show]);
}
