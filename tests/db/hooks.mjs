// Hook de resolución de módulos: redirige los módulos de Next que dependen de la petición HTTP.
const STUBS = new Map([
  ["next/headers", new URL("./stubs/headers.mjs", import.meta.url).href],
  ["next/cache", new URL("./stubs/cache.mjs", import.meta.url).href],
  ["next/server", new URL("./stubs/server.mjs", import.meta.url).href],
  ["next/navigation", new URL("./stubs/navigation.mjs", import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}
