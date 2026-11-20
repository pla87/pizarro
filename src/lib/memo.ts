// Memoria en proceso con caducidad corta para datos que se consultan en cada página y casi nunca cambian (licencia,
// aviso de versión, aviso de copias…). En globalThis: acciones, rutas y páginas pueden empaquetarse por separado y deben
// ver la misma memoria (y la misma invalidación). Lo que cambia desde una acción se invalida al momento (invalidateMemo);
// lo que cambie por otro camino (otro proceso, una herramienta de consola) se ve como mucho al cabo de MEMO_TTL_MS.

/** Caducidad por defecto. */
export const MEMO_TTL_MS = 60_000;

type Entry = { at: number; value: Promise<unknown> };
const g = globalThis as unknown as { __pzMemo?: Map<string, Entry> };
const store = (g.__pzMemo ??= new Map());

/**
 * Valor de `fn` guardado bajo `key` durante `ttlMs`. Las peticiones simultáneas comparten la misma consulta; un error no
 * se guarda (la siguiente vez se vuelve a intentar).
 */
export function memo<T>(key: string, fn: () => Promise<T>, ttlMs: number = MEMO_TTL_MS, now: number = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs && now >= hit.at) return hit.value as Promise<T>;
  const value = fn();
  const entry: Entry = { at: now, value };
  store.set(key, entry);
  value.catch(() => {
    if (store.get(key) === entry) store.delete(key);
  });
  return value;
}

/**
 * Olvida lo guardado bajo `key` y, si acaba en «:», bajo cualquier clave que empiece así. Una consulta que ya estaba en
 * marcha no vuelve a guardarse: la siguiente lectura consulta de nuevo.
 */
export function invalidateMemo(key: string): void {
  if (!key.endsWith(":")) {
    store.delete(key);
    return;
  }
  for (const k of [...store.keys()]) if (k.startsWith(key)) store.delete(k);
}

/** Memoria con caducidad y tope de entradas (las menos usadas salen primero). */
interface BoundedMemo {
  /** Como `memo`: valor guardado, consulta compartida si está en marcha, y un error no se guarda. */
  get<T>(key: string, fn: () => Promise<T>, now?: number): Promise<T>;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

/**
 * Memoria propia (no la de `memo`) para lo que tiene una clave por persona o enlace y podría crecer sin límite: guarda
 * como mucho `maxEntries` claves durante `ttlMs`; al pasarse, olvida la usada hace más tiempo. Por nombre en globalThis
 * (rutas y acciones pueden empaquetarse por separado y deben ver la misma).
 */
export function boundedMemo(name: string, ttlMs: number, maxEntries: number): BoundedMemo {
  const all = ((globalThis as unknown as { __pzBoundedMemo?: Map<string, Map<string, Entry>> }).__pzBoundedMemo ??= new Map());
  let map = all.get(name);
  if (!map) all.set(name, (map = new Map()));
  const entries = map;
  return {
    get<T>(key: string, fn: () => Promise<T>, now: number = Date.now()): Promise<T> {
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs && now >= hit.at) {
        // Map recuerda el orden de inserción: volver a ponerla al final la marca como la más reciente.
        entries.delete(key);
        entries.set(key, hit);
        return hit.value as Promise<T>;
      }
      const value = fn();
      const entry: Entry = { at: now, value };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    delete: (key) => void entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}
