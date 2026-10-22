// Sustituto de next/headers: un «jar» de cookies global que el test controla (ver helpers.ts: loginAs).
const state = (globalThis.__pzTestRequest ??= { jar: new Map() });

const cookieStore = {
  get: (name) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
  set: (name, value) => void state.jar.set(name, String(value)),
  delete: (name) => void state.jar.delete(name),
  has: (name) => state.jar.has(name),
  getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
};

export async function cookies() {
  return cookieStore;
}

export async function headers() {
  return new Headers({ "user-agent": "pizarro-db-tests", "x-real-ip": "127.0.0.1" });
}
