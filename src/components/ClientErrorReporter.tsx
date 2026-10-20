"use client";

import { useEffect } from "react";
import { reportClientError } from "./clientErrors";
import { reloadForNewVersion } from "./VersionWatcher";

/** Acción de una versión anterior: el servidor se ha actualizado y la página tiene el código viejo. */
const STALE_ACTION = /Server Action .* was not found on the server|Failed to find Server Action/i;

/** Registra en los logs las excepciones del navegador que nadie captura. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (STALE_ACTION.test(String(e.message ?? "")) && reloadForNewVersion()) return;
      reportClientError("window", e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      // Tras un despliegue: se recarga para tener el código nuevo en vez de registrar un error.
      if (STALE_ACTION.test(message) && reloadForNewVersion()) return;
      reportClientError("promise", e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
