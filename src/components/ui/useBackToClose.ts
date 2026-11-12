"use client";

import { useEffect, useRef } from "react";

let seq = 0;
type ModalState = { pzModals?: string[] } | null;

// Retrocesos propios para quitar la entrada de un modal cerrado con X/Escape/guardar: se
// silencian (captura en window, antes que el router de Next) porque vuelven al mismo estado
// y, si a la vez se navega a otra página, el router los interpretaría como «atrás» y la anularía.
let silentPops = 0;
let silencerInstalled = false;
/** Lo que espera a que terminen los retrocesos silenciosos en curso (no se puede añadir una entrada mientras tanto). */
let afterSilent: (() => void)[] = [];
function whenNoSilentPops(fn: () => void) {
  if (silentPops === 0) fn();
  else afterSilent.push(fn);
}
/**
 * Ejecuta `fn` cuando los modales ya cerrados han retirado su entrada del historial (al desmontarse hacen un «atrás»
 * silencioso que termina más tarde): para tocar la dirección de la página (p. ej. quitar `?task=`) en la entrada buena y
 * no en la del modal, que desaparece. Llamarla después de desmontarse el modal (en un efecto del padre).
 */
export function afterModalHistory(fn: () => void): void {
  whenNoSilentPops(fn);
}
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
        if (silentPops === 0) {
          const queued = afterSilent;
          afterSilent = [];
          queued.forEach((fn) => fn());
        }
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
 * Si `onClose` devuelve (o resuelve) `false`, el modal no se cerró (p. ej. se pidió confirmación y se dijo que no): la
 * entrada se vuelve a añadir, así el siguiente «atrás» vuelve a cerrar el modal en vez de salir de la página.
 */
export function useBackToClose(active: boolean, onClose: () => void | boolean | Promise<void | boolean>) {
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
    let alive = true;
    const push = () => {
      const state = (window.history.state ?? {}) as NonNullable<ModalState>;
      window.history.pushState({ ...state, pzModals: [...(state.pzModals ?? []), token] }, "");
      pushed = true;
    };
    // Diferido: el doble montaje de React en desarrollo no deja entradas huérfanas.
    const timer = setTimeout(push, 0);
    const onPop = (e: PopStateEvent) => {
      if (silentEvents.has(e)) return;
      if (pushed && !inState()) {
        closedByBack = true;
        void Promise.resolve(onCloseRef.current()).then((closed) => {
          if (closed !== false || !alive) return;
          // No se cerró: vuelve la entrada (tras los retrocesos propios pendientes, p. ej. el del diálogo de confirmación).
          closedByBack = false;
          // Diferido: antes se cierra el diálogo de confirmación y retira su propia entrada.
          setTimeout(() => whenNoSilentPops(() => {
            if (alive && !inState()) push();
          }), 0);
        });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      // Cerrado sin el botón atrás: quitar nuestra entrada (si no se ha navegado a otra página).
      if (pushed && !closedByBack && inState()) silentBack();
    };
  }, [active]);
}
