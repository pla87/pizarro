"use client";

import { useCallback, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { actionThrowMessage } from "@/lib/stale-action";

/**
 * `useTransition` para lanzar acciones de servidor (formularios y botones de Administración, Mi perfil, ajustes del
 * proyecto, acceso…). Úsalo en lugar de `useTransition` siempre que la transición llame a una acción.
 *
 * Una acción que no llega al servidor (sin red, servidor caído o reiniciándose) no devuelve `{ ok: false }`: lanza. Dentro
 * de `startTransition` ese error subía hasta la pantalla «Algo ha fallado» y se perdía lo escrito. Aquí se recoge y se
 * avisa como en el resto de la app: «Sin conexión: no se ha guardado» (con el aviso de sin conexión, que se quita solo
 * al volver la red), «Hay una versión nueva…» si la página es de una versión anterior, o el error genérico. Por defecto
 * en un aviso emergente; con `onError`, donde diga quien lo usa (el texto de error de un formulario sin avisos, como los
 * de acceso). Las redirecciones de Next (que viajan como excepciones) siguen su camino.
 */
export function useActionTransition(onError?: (message: string) => void): [pending: boolean, run: (fn: () => Promise<unknown> | void) => void] {
  const [pending, start] = useTransition();
  const t = useT();
  const toast = useToast();
  const run = useCallback(
    (fn: () => Promise<unknown> | void) =>
      start(async () => {
        try {
          await fn();
        } catch (err) {
          const digest = (err as { digest?: unknown } | null)?.digest;
          if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
          const message = actionThrowMessage(err, t);
          if (onError) onError(message);
          else toast(message, "error");
        }
      }),
    [start, t, toast, onError],
  );
  return [pending, run];
}
