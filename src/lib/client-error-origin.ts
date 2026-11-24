// ¿Viene de los scripts de la app un error sin capturar? La consola del navegador, una extensión o un script ajeno también
// lanzan «unhandledrejection» y «error» en la página («Junk found after end of compressed data»), y no son fallos de
// Pizarro. Un rechazo de la app lleva en su pila algún fichero del propio origen bajo /_next/ (también un fetch que falla:
// la pila tiene la línea de la app que lo lanzó); sin pila, o con una sin ninguno, no se registra. Un error de ventana
// trae además el fichero donde saltó (ver windowErrorFromApp).

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

/** Esquemas de los scripts de las extensiones del navegador (Chrome y Edge, Firefox, Safari). */
const EXTENSION_FILE = /^(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

/**
 * ¿Es de la app un error de ventana («error»)? `filename` es el script donde saltó: no, si es de una extensión; sí, si es
 * del propio origen (los ficheros de /_next/, o la propia página en sus scripts en línea) o si, sin fichero propio (un
 * script de otro origen al que la app llamó), la pila pasa por los scripts de la app. Sin fichero ni pila de la app (el
 * «Script error.» de un script ajeno, la consola) no se registra.
 */
export function windowErrorFromApp(e: { filename?: string | null; error?: unknown }, origin: string): boolean {
  const file = e.filename ?? "";
  if (EXTENSION_FILE.test(file)) return false;
  return file.startsWith(`${origin}/`) || rejectionFromApp(e.error, origin);
}
