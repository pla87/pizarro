// redirect(), notFound(), forbidden() y unauthorized() de Next funcionan lanzando un error con un «digest» propio. Si
// la página ya había empezado a llegar al navegador (dentro de un Suspense o de un loading.tsx), React lo recibe como un
// error de ese fragmento («Minified React error #419» con el digest NEXT_REDIRECT;replace;/admin/users;307;) y el
// navegador lo emite como excepción no capturada, aunque Next hace la redirección o enseña la página de «no encontrado»
// sin problema. No es un fallo: no se registra en Administración → Logs (ni lo envía el navegador ni lo guarda el servidor).

const PREFIXES = ["NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK", "NEXT_NOT_FOUND"];

const isSignal = (s: unknown) => typeof s === "string" && PREFIXES.some((p) => s === p || s.startsWith(`${p};`));

/** ¿Es la señal de una redirección o un «no encontrado» de Next (por su digest o, en desarrollo, por su mensaje)? */
export function isNextNavigationSignal(digest?: string | null, message?: string | null): boolean {
  return isSignal(digest) || isSignal(message);
}
