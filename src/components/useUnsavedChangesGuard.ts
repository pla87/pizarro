"use client";

import { useEffect, useRef } from "react";

/** Enlace que, pulsado, cambia de página dentro de la app (no abre otra pestaña ni descarga, y no es un ancla de la misma). */
function inAppNavigation(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  // Solo cambia el ancla: la página (y lo que se edita) sigue ahí.
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return null;
  if (url.href === window.location.href) return null;
  return a;
}

/** Espera (unos fotogramas como mucho) a que el elemento deje de estar dentro de algo `inert`. */
async function untilInteractive(el: Element): Promise<void> {
  for (let i = 0; i < 60 && el.isConnected && el.closest("[inert]"); i++) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50);
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * Mientras `dirty()` sea cierto, avisa antes de perder lo escrito: al recargar o cerrar la pestaña (el aviso del
 * navegador, `beforeunload`) y al seguir un enlace de la app (pestañas de Ajustes y Mi perfil, barra lateral…), con
 * `ask()` (p. ej. el diálogo «Cambios sin guardar»). Si se acepta, el clic se repite tal cual (el enlace hace lo suyo:
 * `replace`, precarga…). Con `active` falso no escucha nada. Atrás y Adelante del navegador no se pueden detener así.
 */
export function useUnsavedChangesGuard(active: boolean, dirty: () => boolean, ask: () => Promise<boolean>) {
  const latest = useRef({ dirty, ask });
  useEffect(() => {
    latest.current = { dirty, ask };
  });
  useEffect(() => {
    if (!active) return;
    let pass: HTMLAnchorElement | null = null;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!latest.current.dirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = inAppNavigation(e);
      if (!a) return;
      if (pass === a) {
        pass = null;
        return;
      }
      if (!latest.current.dirty()) return;
      // Antes que el `Link` de Next (escucha en la raíz de React, por debajo de document en la fase de captura).
      e.preventDefault();
      e.stopPropagation();
      void latest.current.ask().then(async (ok) => {
        if (!ok) return;
        // El diálogo de confirmación deja el resto de la página `inert` hasta que React lo desmonta, y un clic sobre un
        // elemento inerte se pierde sin hacer nada: se espera a que vuelva a estar activo antes de repetirlo.
        await untilInteractive(a);
        if (!a.isConnected) return;
        pass = a;
        a.click();
        // El clic es síncrono: si ningún oyente lo consumió (no era una navegación de la app), el pase no se queda puesto.
        pass = null;
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
}
