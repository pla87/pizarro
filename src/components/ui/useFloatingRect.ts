"use client";

import { useEffect, useState, type RefObject } from "react";

const sameRect = (a: DOMRect | null, b: DOMRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/**
 * Posición en pantalla de un elemento de la cabecera mientras hay un modal abierto (solo escritorio, lg+),
 * para dibujar una copia encima del fondo difuminado. Devuelve null si no hay que copiarlo: sin modal, en móvil
 * o si el panel de algún diálogo cae justo encima (la copia taparía su contenido).
 */
export function useFloatingRect(ref: RefObject<HTMLElement | null>, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      let next: DOMRect | null = r && r.width > 0 && window.matchMedia("(min-width: 1024px)").matches ? r : null;
      if (next) {
        const n = next;
        const covered = Array.from(document.querySelectorAll("[role=dialog]")).some((d) => {
          const p = d.getBoundingClientRect();
          return p.left < n.right && p.right > n.left && p.top < n.bottom && p.bottom > n.top;
        });
        if (covered) next = null;
      }
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const frame = requestAnimationFrame(measure);
    // Los paneles cambian de tamaño al cargar su contenido: se vuelve a comprobar con calma.
    const timer = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [ref, active]);
  return active ? rect : null;
}
