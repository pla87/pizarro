"use client";

import { useEffect, useState } from "react";
import { withoutCsvParams } from "@/lib/log-csv";

/**
 * Aviso «No se ha descargado el CSV» tras volver de una descarga fallida (`?csv=`). Al mostrarse quita los parámetros de
 * la dirección (sin recargar), y se oculta al pulsar otra vez «Descargar CSV»: si esa descarga funciona, la página no
 * navega (el CSV llega como adjunto) y el aviso se quedaba a la vista; si vuelve a fallar, la página vuelve con su aviso.
 */
export function CsvErrorNotice({ formId, children }: { formId: string; children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const clean = withoutCsvParams(pathname, search, hash);
    if (clean !== `${pathname}${search}${hash}`) window.history.replaceState(window.history.state, "", clean);
    const onSubmit = (e: SubmitEvent) => {
      if (e.target instanceof HTMLFormElement && e.target.id === formId) setHidden(true);
    };
    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, [formId]);
  if (hidden) return null;
  return (
    <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      {children}
    </p>
  );
}
