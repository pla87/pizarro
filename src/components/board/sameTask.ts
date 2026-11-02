import type { BoardTask } from "@/lib/types";

/** Igualdad de dos tarjetas: campos simples, listas de valores simples y `blockedBy` ({id, title} que llega nuevo en cada lectura). */
export const sameTask = (a: BoardTask, b: BoardTask) => {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => {
    const p = x[k];
    const q = y[k];
    if (p === q) return true;
    if (k === "blockedBy") {
      if (p == null || q == null) return p == null && q == null;
      const bp = p as { id: string; title: string };
      const bq = q as { id: string; title: string };
      return bp.id === bq.id && bp.title === bq.title;
    }
    return Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => v === q[i]);
  });
};
