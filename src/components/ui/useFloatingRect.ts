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
    // Se mide una vez por fotograma como mucho, solo cuando algo cambia (antes, cada 400 ms con el modal abierto).
    let frame = requestAnimationFrame(measure);
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Los paneles cambian de tamaño al cargar su contenido (y con él, al estar centrados, de sitio): se observan los
    // diálogos y el propio elemento. Los diálogos se pintan en un portal directo de <body>: al abrirse o cerrarse otro
    // (la pareja de modales, una confirmación, el visor de imágenes) se vuelve a mirar cuáles hay.
    const sizes = new ResizeObserver(schedule);
    const observeAll = () => {
      sizes.disconnect();
      if (ref.current) sizes.observe(ref.current);
      for (const d of document.querySelectorAll("[role=dialog]")) sizes.observe(d);
    };
    observeAll();
    const dialogs = new MutationObserver(() => {
      observeAll();
      schedule();
    });
    dialogs.observe(document.body, { childList: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      dialogs.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [ref, active]);
  return active ? rect : null;
}
