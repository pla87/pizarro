"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createStore } from "./stores";

/**
 * Qué tarjetas se apuntan al arrastre (dnd-kit). Todas las tarjetas se pintan siempre (el DOM, el foco, el lector de
 * pantalla, la búsqueda del navegador y las alturas no cambian), pero solo las que están a la vista de su columna, o
 * cerca, llevan `useSortable`. Con cientos de tarjetas, cada cambio del arrastre (otra tarjeta debajo, otra columna, otra
 * medida) redibujaba y medía TODAS las tarjetas apuntadas, y en un equipo lento el arrastre iba a tirones. Así el coste
 * depende de lo que cabe en pantalla y no del número de tarjetas. Las que quedan lejos no necesitan moverse: no se ven.
 *
 * Cerca = dentro de la lista con scroll de la columna o a menos de 300 px por encima o por debajo (IntersectionObserver
 * con la lista como raíz). Durante un arrastre una tarjeta puede apuntarse (scroll automático) pero no se borra hasta
 * soltar: así no desaparece a medio arrastre la que está debajo del puntero ni la que se arrastra.
 */

/** Tarjeta que se está arrastrando (id) o `null`. La pone el tablero al empezar y al terminar el arrastre. */
export const draggingCard = createStore<string | null>(null);

type Setter = (near: boolean) => void;

interface ListWatch {
  io: IntersectionObserver;
  setters: Map<Element, Setter>;
  /** Última respuesta del observador por tarjeta (para aplicar al soltar lo que se dejó pendiente). */
  near: Map<Element, boolean>;
}

const lists = new WeakMap<Element, ListWatch>();
/** Tarjetas que se alejaron durante un arrastre: se desapuntan al terminar (si siguen lejos). */
const pendingFar = new Map<Element, ListWatch>();

draggingCard.subscribe(() => {
  if (draggingCard.get() !== null || !pendingFar.size) return;
  for (const [el, watch] of pendingFar) if (watch.near.get(el) === false) watch.setters.get(el)?.(false);
  pendingFar.clear();
});

// Anclaje del scroll: al cambiar algo por encima de lo visible, el navegador mueve el scroll de la lista para que no salte
// lo que se ve. Durante un arrastre dnd-kit ya coloca cada tarjeta, y el ajuste del navegador al soltar movía la lista unos
// píxeles (antes no pasaba porque todas las tarjetas llevaban transform, que lo anula). Se quita mientras se arrastra y
// hasta que terminan las animaciones de soltar (200 ms en dnd-kit).
const ANCHOR_AFTER_DROP_MS = 400;
let anchorTimer: ReturnType<typeof setTimeout> | undefined;
draggingCard.subscribe(() => {
  const root = document.documentElement;
  clearTimeout(anchorTimer);
  if (draggingCard.get() !== null) root.setAttribute("data-card-drag", "");
  else anchorTimer = setTimeout(() => root.removeAttribute("data-card-drag"), ANCHOR_AFTER_DROP_MS);
});

function watchFor(list: Element): ListWatch {
  const watch = lists.get(list);
  if (watch) return watch;
  const created: ListWatch = {
    setters: new Map(),
    near: new Map(),
    io: new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const near = e.isIntersecting;
          created.near.set(e.target, near);
          if (!near && draggingCard.get() !== null) pendingFar.set(e.target, created);
          else created.setters.get(e.target)?.(near);
        }
      },
      // La lista hace de ventana, con un margen arriba y abajo (el scroll automático las apunta antes de que se vean). Una
      // columna oculta (móvil) no tiene tarjetas cerca.
      { root: list, rootMargin: "300px 0px" },
    ),
  };
  lists.set(list, created);
  return created;
}

/**
 * ¿La tarjeta debe apuntarse al arrastre? Devuelve `[cerca, ref, apuntarYa]`: el ref va en el nodo de la tarjeta. La que
 * se arrastra lo está siempre (al pasar a otra columna se monta de nuevo allí y no puede esperar al observador).
 * `apuntarYa()` la apunta en el acto (flushSync): para pulsar una tarjeta que acaba de entrar en la vista antes de que el
 * observador haya respondido (un scroll rápido seguido de arrastrar, o un equipo muy lento).
 */
export function useNearCard(id: string): [boolean, (el: HTMLElement | null) => (() => void) | undefined, () => void] {
  const [near, setNear] = useState(false);
  const bindNow = useCallback(() => flushSync(() => setNear(true)), []);
  const active = useSyncExternalStore(draggingCard.subscribe, () => draggingCard.get() === id, () => false);
  const ref = useCallback((el: HTMLElement | null) => {
    const list = el?.closest("[data-card-list]");
    if (!el || !list || typeof IntersectionObserver === "undefined") return undefined;
    const watch = watchFor(list);
    watch.setters.set(el, setNear);
    watch.io.observe(el);
    return () => {
      watch.io.unobserve(el);
      watch.setters.delete(el);
      watch.near.delete(el);
      pendingFar.delete(el);
    };
  }, []);
  return [near || active, ref, bindNow];
}
