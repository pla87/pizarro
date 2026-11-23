// ¿Viene de los scripts de la app un rechazo de promesa sin capturar? La consola del navegador, una extensión o un script
// ajeno también lanzan «unhandledrejection» en la página («Junk found after end of compressed data»), y no son fallos de
// Pizarro. Un error de la app lleva en su pila algún fichero del propio origen bajo /_next/ (también un fetch que falla:
// la pila tiene la línea de la app que lo lanzó); sin pila, o con una sin ninguno, no se registra.

/** Pila del motivo del rechazo (un Error o cualquier objeto con `stack` de texto). */
function stackOf(reason: unknown): string {
  if (reason && typeof reason === "object" && "stack" in reason) {
    const stack = (reason as { stack?: unknown }).stack;
    if (typeof stack === "string") return stack;
  }
  return "";
}

/** `origin`: el de la página (`location.origin`). */
export function rejectionFromApp(reason: unknown, origin: string): boolean {
  return stackOf(reason).includes(`${origin}/_next/`);
}
