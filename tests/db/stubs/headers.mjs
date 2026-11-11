// Sustituto de next/headers: un «jar» de cookies global que el test controla (ver helpers.ts: loginAs).
// Como en Next, cookies() devuelve el mismo objeto durante una petición y uno distinto en cada petición: dentro de
// inRequest() (helpers.ts) es el de esa petición simulada; fuera, uno nuevo en cada llamada (cada llamada es como
// una petición aparte, así que nada se reutiliza de una a otra).
import { AsyncLocalStorage } from "node:async_hooks";

const state = (globalThis.__pzTestRequest ??= { jar: new Map() });
const scope = (state.scope ??= new AsyncLocalStorage());

function makeCookieStore() {
  return {
    get: (name) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
    set: (name, value) => void state.jar.set(name, String(value)),
    delete: (name) => void state.jar.delete(name),
    has: (name) => state.jar.has(name),
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
  };
}

/** Ejecuta `fn` como una sola petición: todas sus llamadas a cookies() reciben el mismo objeto. */
state.inRequest ??= (fn) => scope.run(makeCookieStore(), fn);

export async function cookies() {
  return scope.getStore() ?? makeCookieStore();
}

// Cabeceras extra que un test fija (p. ej. las que pone el proxy, como x-pz-auth-link): state.headers.
export async function headers() {
  return new Headers({ "user-agent": "pizarro-db-tests", "x-real-ip": "127.0.0.1", ...(state.headers ?? {}) });
}
