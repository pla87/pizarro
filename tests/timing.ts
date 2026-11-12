// Medidas de tiempo para las guardas de rendimiento de las pruebas. Con la máquina cargada (otras pruebas, compilaciones o
// agentes a la vez) una sola medida puede salir varias veces más lenta: se toma la mejor de varias, y se para en cuanto una
// queda por debajo del tope. Lo que se vigila (algo cuadrático o un retroceso catastrófico) tarda decenas de veces más en
// todas las medidas, así que la guarda sigue fallando cuando debe.
import assert from "node:assert/strict";

/** La mejor de `runs` medidas (en ms) de `fn(i)`; `i` es el número de intento, por si cada uno necesita una entrada distinta. */
export function bestTime(fn: (i: number) => unknown, { runs = 3, under = 0 }: { runs?: number; under?: number } = {}): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    best = Math.min(best, performance.now() - t0);
    if (best < under) break;
  }
  return best;
}

/** Comprueba que `fn` tarda menos de `maxMs` en alguna de tres medidas y devuelve el resultado de la última. */
export function assertFast<R>(maxMs: number, fn: (i: number) => R, label = "tardó"): R {
  let out!: R;
  const ms = bestTime((i) => (out = fn(i)), { under: maxMs });
  assert.ok(ms < maxMs, `${label} ${Math.round(ms)} ms (máximo ${maxMs}, la mejor de tres)`);
  return out;
}
