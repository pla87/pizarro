import { NEW_VERSION_EVENT, isStaleActionError } from "./stale-action";

/**
 * Envuelve la acción de un formulario con useActionState (acceso, verificación en dos pasos). Esas acciones, si lanzan,
 * propagan el error al render y, sin un error.tsx debajo, se llega a la pantalla «Algo ha fallado» sin remedio.
 * Si la página es de una versión anterior (la acción ya no existe en el servidor), se recarga (`reload`) para
 * traer la actual; si no puede recargar (ya lo hizo hace nada), se avisa con el banner de versión nueva y un mensaje en el formulario.
 */
export function guardFormAction<S extends { error?: string }>(
  action: (prev: S, form: FormData) => Promise<S>,
  t: (s: string) => string,
  reload: () => boolean,
): (prev: S, form: FormData) => Promise<S> {
  return async (prev, form) => {
    try {
      return await action(prev, form);
    } catch (err) {
      // Las redirecciones de Next viajan como excepciones: no son un fallo.
      const digest = (err as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
      if (isStaleActionError(err)) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event(NEW_VERSION_EVENT));
        reload();
        return { ...prev, error: t("Hay una versión nueva de Pizarro. Recarga para seguir.") };
      }
      return { ...prev, error: t("Error inesperado. Inténtalo de nuevo.") };
    }
  };
}
