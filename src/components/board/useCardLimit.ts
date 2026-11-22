"use client";

import { startTransition, useEffect, useState } from "react";
import { FIRST_PAINT_CARDS, nextCardLimit } from "./deferredCards";

/**
 * Cuántos elementos de una lista de `count` se pintan: `first` en el servidor y al hidratar; después, tanda a tanda
 * cuando el navegador está libre, hasta todos. Una vez todos, ya no vuelve a recortar (lista que crece, filtro que se
 * quita). Lo usan las columnas del tablero (FIRST_PAINT_CARDS) y la vista Lista (FIRST_PAINT_ROWS).
 */
export function useCardLimit(count: number, first: number = FIRST_PAINT_CARDS): number {
  const [limit, setLimit] = useState(first);
  useEffect(() => {
    if (limit === Infinity) return;
    const next = () => startTransition(() => setLimit((l) => nextCardLimit(l, count)));
    // Sin requestIdleCallback (Safari), en la vuelta siguiente. Con él, como mucho al segundo aunque no quede libre.
    if (typeof window.requestIdleCallback !== "function") {
      const id = window.setTimeout(next, 1);
      return () => window.clearTimeout(id);
    }
    const id = window.requestIdleCallback(next, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }, [limit, count]);
  return limit;
}
