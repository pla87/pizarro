// Pestañas abiertas antes de un despliegue: su código llama a acciones que el servidor nuevo ya no tiene.
// Next lanza entonces «Failed to find Server Action …» (o «Server Action … was not found on the server»).

/** Acción de una versión anterior: el servidor se ha actualizado y la página tiene el código viejo. */
export const STALE_ACTION = /Server Action .* was not found on the server|Failed to find Server Action|older or newer deployment/i;

/** Evento de window con el que cualquier código cliente pide mostrar el aviso de versión nueva. */
export const NEW_VERSION_EVENT = "pz:new-version";

export function isStaleActionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return STALE_ACTION.test(message);
}

/**
 * Para el `catch` de una server action que lanza. Si es una pestaña antigua, muestra el aviso «Recarga para
 * seguir» (VersionWatcher, sin recargar sola: puede haber texto sin guardar) y devuelve ese mensaje; si no, el genérico.
 */
export function actionThrowMessage(err: unknown, t: (s: string) => string): string {
  if (isStaleActionError(err) && typeof window !== "undefined") {
    window.dispatchEvent(new Event(NEW_VERSION_EVENT));
    return t("Hay una versión nueva de Pizarro. Recarga para seguir.");
  }
  return t("Error inesperado. Inténtalo de nuevo.");
}

/** Igual que `actionThrowMessage`, ya con la forma de fallo de una acción. */
export function actionThrowResult(err: unknown, t: (s: string) => string): { ok: false; error: string } {
  return { ok: false, error: actionThrowMessage(err, t) };
}
