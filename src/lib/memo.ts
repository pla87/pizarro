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
  /** Bytes guardados según `sizeOf` (0 sin él). */
  readonly bytes: number;
}

interface BoundedOptions {
  /** Tope de bytes de todo lo guardado (con `sizeOf`): al pasarse, salen las menos usadas. */
  maxBytes?: number;
  /** Bytes que ocupa un valor ya resuelto. */
  sizeOf?: (value: unknown) => number;
}

type SizedEntry = Entry & { bytes: number };
type BoundedState = { entries: Map<string, SizedEntry>; bytes: number; sweptAt: number };

const boundedStates = () => ((globalThis as unknown as { __pzBoundedMemos?: Map<string, BoundedState> }).__pzBoundedMemos ??= new Map());

/** Vacía la memoria `name` de boundedMemo sin cargar el módulo que la usa (p. ej. al revocar accesos: revoke.ts). */
export function clearBoundedMemo(name: string): void {
  const st = boundedStates().get(name);
  if (!st) return;
  st.entries.clear();
  st.bytes = 0;
}

/**
 * Memoria propia (no la de `memo`) para lo que tiene una clave por persona o enlace y podría crecer sin límite: guarda
 * como mucho `maxEntries` claves durante `ttlMs`; al pasarse, olvida la usada hace más tiempo. Lo caducado sale al leer
 * (un barrido como mucho cada `ttlMs`), no solo al llegar al tope: si no, quedaban retenidas hasta `maxEntries` respuestas
 * ya inservibles. Con `maxBytes` y `sizeOf`, además, un tope de memoria. Por nombre en globalThis (rutas y acciones
 * pueden empaquetarse por separado y deben ver la misma).
 */
export function boundedMemo(name: string, ttlMs: number, maxEntries: number, opts: BoundedOptions = {}): BoundedMemo {
  const all = boundedStates();
  let state = all.get(name);
  if (!state) all.set(name, (state = { entries: new Map(), bytes: 0, sweptAt: -Infinity }));
  const st = state;
  const { entries } = st;
  const drop = (key: string) => {
    const e = entries.get(key);
    if (!e) return;
    st.bytes -= e.bytes;
    entries.delete(key);
  };
  const dropOldest = () => drop(entries.keys().next().value!);
  const sweep = (now: number) => {
    if (now - st.sweptAt < ttlMs && now >= st.sweptAt) return;
    st.sweptAt = now;
    for (const [key, e] of entries) if (now - e.at >= ttlMs) drop(key);
  };
  return {
    get<T>(key: string, fn: () => Promise<T>, now: number = Date.now()): Promise<T> {
      sweep(now);
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs && now >= hit.at) {
        // Map recuerda el orden de inserción: volver a ponerla al final la marca como la más reciente.
        entries.delete(key);
        entries.set(key, hit);
        return hit.value as Promise<T>;
      }
      const value = fn();
      const entry: SizedEntry = { at: now, value, bytes: 0 };
      drop(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) dropOldest();
      value.then(
        (v) => {
          if (!opts.sizeOf || entries.get(key) !== entry) return;
          entry.bytes = opts.sizeOf(v);
          st.bytes += entry.bytes;
          // Las menos usadas primero; si ella sola pasa del tope, tampoco se guarda.
          while (opts.maxBytes !== undefined && st.bytes > opts.maxBytes && entries.size > 0) dropOldest();
        },
        () => {
          if (entries.get(key) === entry) drop(key);
        },
      );
      return value;
    },
    delete: (key) => drop(key),
    clear: () => clearBoundedMemo(name),
    get size() {
      return entries.size;
    },
    get bytes() {
      return st.bytes;
    },
  };
}
