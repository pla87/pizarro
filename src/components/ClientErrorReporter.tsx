"use client";

import { useEffect } from "react";
import { reportClientError } from "./clientErrors";
import { NEW_VERSION_EVENT, STALE_ACTION } from "@/lib/stale-action";
import { busy, reloadForNewVersion } from "./VersionWatcher";

/** Pestaña antigua: se recarga sola si no hay nada a medias; si lo hay, se muestra el aviso con el botón. */
function staleTab(): boolean {
  if (busy()) {
    window.dispatchEvent(new Event(NEW_VERSION_EVENT));
    return true;
  }
  return reloadForNewVersion();
}

/** Registra en los logs las excepciones del navegador que nadie captura. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (STALE_ACTION.test(String(e.message ?? "")) && staleTab()) return;
      reportClientError("window", e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      // Tras un despliegue: se recarga para tener el código nuevo en vez de registrar un error.
      if (STALE_ACTION.test(message) && staleTab()) return;
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
