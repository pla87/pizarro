"use client";

import { useEffect } from "react";

const MARGIN = 6; // 3 px de contorno + 2 de separación (y algo de aire)

/** Con el teclado, el navegador solo desplaza lo justo para que el elemento enfocado sea visible: si queda pegado al borde de un
 *  contenedor con scroll, el anillo de foco se recorta. Esto deja siempre un margen alrededor del elemento enfocado. */
export function useFocusRingScroll() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(":focus-visible")) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== el) return;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          const sy = /(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight;
          const sx = /(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth;
          if (!sy && !sx) continue;
          const ar = a.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          if (sy) {
            const top = ar.top + a.clientTop, bottom = top + a.clientHeight;
            if (r.height + 2 * MARGIN <= a.clientHeight) {
              if (r.bottom + MARGIN > bottom) a.scrollTop += r.bottom + MARGIN - bottom;
              else if (r.top - MARGIN < top) a.scrollTop -= top - (r.top - MARGIN);
            }
          }
          if (sx) {
            const left = ar.left + a.clientLeft, right = left + a.clientWidth;
            if (r.width + 2 * MARGIN <= a.clientWidth) {
              if (r.right + MARGIN > right) a.scrollLeft += r.right + MARGIN - right;
              else if (r.left - MARGIN < left) a.scrollLeft -= left - (r.left - MARGIN);
            }
          }
        }
      });
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
}
