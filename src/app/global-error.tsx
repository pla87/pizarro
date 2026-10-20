"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/components/clientErrors";
import { makeT, type Locale } from "@/i18n/core";

/** Error en el propio layout raíz: se registra y se ofrece recargar. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError("global-error", error, error.digest), [error]);
  // Sin proveedor (el layout raíz ha fallado): el idioma se deduce del navegador.
  const [locale, setLocale] = useState<Locale>("es");
  useEffect(() => setLocale(/^en\b/i.test(navigator.language) ? "en" : "es"), []);
  const t = makeT(locale);
  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>{t("Algo ha fallado")}</p>
          <p style={{ color: "#64748b", fontSize: 14 }}>{t("El error ha quedado registrado. Prueba a recargar.")}</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: 0, background: "#4f46e5", color: "#fff" }}>{t("Reintentar")}</button>
        </div>
      </body>
    </html>
  );
}
