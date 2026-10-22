"use client";

import { useEffect, useRef } from "react";

let seq = 0;
type ModalState = { pzModals?: string[] } | null;

// Retrocesos propios para quitar la entrada de un modal cerrado con X/Escape/guardar: se
// silencian (captura en window, antes que el router de Next) porque vuelven al mismo estado
// y, si a la vez se navega a otra página, el router los interpretaría como «atrás» y la anularía.
let silentPops = 0;
let silencerInstalled = false;
// Eventos popstate provocados por nosotros: los modales los ignoran aunque otro escuchador se ejecute antes
// que el silenciador (no depende del orden de registro ni de la fase).
const silentEvents = new WeakSet<Event>();
function installSilencer() {
  if (silencerInstalled || typeof window === "undefined") return;
  silencerInstalled = true;
  window.addEventListener(
    "popstate",
    (e) => {
      if (silentPops > 0) {
        silentPops--;
        silentEvents.add(e);
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}
function silentBack() {
  installSilencer();
  silentPops++;
  window.history.back();
}

/**
 * Mientras `active`, añade una entrada al historial: el botón atrás del navegador (o del
 * móvil) cierra el modal en vez de salir de la página. Si se cierra de otro modo (X, Escape,
 * guardar), se retira esa entrada para que el historial quede como estaba.
 */
export function useBackToClose(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    // Instalado ya al abrir el primer modal: así va por delante de los escuchadores de los modales.
    installSilencer();
    const token = `m${++seq}`;
    const inState = () => ((window.history.state as ModalState)?.pzModals ?? []).includes(token);
    let pushed = false;
    let closedByBack = false;
    // Diferido: el doble montaje de React en desarrollo no deja entradas huérfanas.
    const timer = setTimeout(() => {
      const state = (window.history.state ?? {}) as NonNullable<ModalState>;
      window.history.pushState({ ...state, pzModals: [...(state.pzModals ?? []), token] }, "");
      pushed = true;
    }, 0);
    const onPop = (e: PopStateEvent) => {
      if (silentEvents.has(e)) return;
      if (pushed && !inState()) {
        closedByBack = true;
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      // Cerrado sin el botón atrás: quitar nuestra entrada (si no se ha navegado a otra página).
      if (pushed && !closedByBack && inState()) silentBack();
    };
  }, [active]);
}
