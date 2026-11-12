"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Cabecera del tablero (escritorio): nunca se sale de la pantalla. El nombre del proyecto se trunca (con el nombre
 * completo en el tooltip) y, si así le quedaría menos de NAME_MIN píxeles, los botones pasan a solo icono:
 *
 * - `full`: botones con texto («Archivadas», «Varias tareas», «Informe PDF», «Nueva tarea»).
 * - `icons`: solo iconos, salvo «Nueva» (el botón principal conserva una palabra).
 * - `tight`: todo con icono; el nombre se lleva lo que quede.
 *
 * Se decide con el espacio real (ResizeObserver sobre la fila y sus elementos), no con el ancho de la ventana: depende
 * de lo largo que sea el nombre, de cuántas personas haya activas y de si hay filtros. Antes de medir (HTML del
 * servidor, sin JavaScript aún) vale la regla de contenedor de siempre (texto a partir de 1240 px de cabecera).
 */
export type HeaderFit = "full" | "icons" | "tight";
const LEVELS: HeaderFit[] = ["full", "icons", "tight"];

/** Lo que el nombre debe poder enseñar antes de quitar textos a los botones (o el nombre entero, si es más corto). */
const NAME_MIN = 240;
/** Margen para volver a poner los textos: evita que la cabecera cambie de un modo a otro con cada píxel. */
const HYSTERESIS = 16;

/** Texto de un botón de la cabecera: se ve en `full` (o, antes de medir, con una cabecera de 1240 px o más). */
export const HEADER_LABEL = "hidden @min-[1240px]:inline [[data-labels=full]_&]:inline [[data-labels=icons]_&]:hidden [[data-labels=tight]_&]:hidden";
/** «Nueva» (texto corto del botón principal): solo en `icons` (o, antes de medir, por debajo de 1240 px). */
export const HEADER_SHORT_LABEL = "@min-[1240px]:hidden [[data-labels=full]_&]:hidden [[data-labels=icons]_&]:inline [[data-labels=tight]_&]:hidden";

/** Ancho que ocupa un elemento en la fila, con sus márgenes (algunos son negativos para juntar iconos). */
function outerWidth(el: Element): number {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.position === "fixed" || style.position === "absolute") return -1;
  // El buscador encoge con poco sitio: cuenta su ancho cómodo (data-fit-basis), no el que tenga en ese momento. Su margen
  // es «auto» (lo empuja a la derecha y se queda con el sitio libre): no cuenta.
  const basis = Number((el as HTMLElement).dataset.fitBasis);
  if (basis > 0) return basis;
  return el.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
}

/** Ancho que necesitaría el nombre para verse entero (el texto truncado sigue midiendo su ancho completo en scrollWidth). */
function naturalNameWidth(name: HTMLElement): number {
  const text = name.querySelector<HTMLElement>("[data-project-name]");
  const box = name.getBoundingClientRect().width;
  return text ? box - text.clientWidth + text.scrollWidth : name.scrollWidth;
}

export function useHeaderFit(rowRef: RefObject<HTMLElement | null>, nameRef: RefObject<HTMLElement | null>): HeaderFit | null {
  const [fit, setFit] = useState<HeaderFit | null>(null);
  // Lo que añaden los textos al pasar de un modo al siguiente (se mide al cambiar; los textos no cambian de ancho).
  const extra = useRef<(number | null)[]>([null, null]);
  const pending = useRef<{ from: number; rest: number } | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const name = nameRef.current;
    if (!row || !name || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const current = fit;
      // Fuera de la vista (móvil/tableta, cabecera oculta): no hay nada que medir.
      if (row.getClientRects().length === 0) return;
      if (current === null) return setFit("full");
      const style = getComputedStyle(row);
      const width = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      let rest = 0;
      let shown = 0;
      for (const child of row.children) {
        if (child === name) continue;
        const w = outerWidth(child);
        if (w < 0) continue;
        rest += w;
        shown++;
      }
      rest += gap * shown; // un hueco entre cada par (el nombre incluido)
      const level = LEVELS.indexOf(current);
      // Acaba de pasar al modo siguiente: lo que ocupaban los textos que se han quitado.
      if (pending.current && pending.current.from === level - 1) extra.current[level - 1] = Math.max(0, pending.current.rest - rest);
      pending.current = null;
      const want = Math.min(naturalNameWidth(name), NAME_MIN);
      if (width - rest < want && level < LEVELS.length - 1) {
        pending.current = { from: level, rest };
        setFit(LEVELS[level + 1]!);
        return;
      }
      const back = level > 0 ? extra.current[level - 1] : null;
      if (back != null && width - rest - back >= want + HYSTERESIS) setFit(LEVELS[level - 1]!);
    };
    const resize = new ResizeObserver(() => measure());
    const watch = () => {
      resize.disconnect();
      resize.observe(row);
      for (const child of row.children) resize.observe(child);
      const text = name.querySelector("[data-project-name]");
      if (text) resize.observe(text);
    };
    watch();
    // Elementos que aparecen y desaparecen (personas activas, «Limpiar filtros»): se vigilan también.
    const mutations = new MutationObserver(() => {
      watch();
      measure();
    });
    mutations.observe(row, { childList: true });
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [rowRef, nameRef, fit]);

  return fit;
}
