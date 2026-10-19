"use client";

import { useEffect } from "react";
import { reportClientError } from "./clientErrors";

/** Registra en los logs las excepciones del navegador que nadie captura. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("window", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError("promise", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
