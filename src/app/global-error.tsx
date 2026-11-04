"use client";

import { useEffect, useSyncExternalStore } from "react";
import { handleBoundaryError } from "@/components/clientErrors";
import type { Locale } from "@/i18n/shared";

// Textos propios y sin proveedor de idioma: si el error viene de un fragmento que no carga (tras un despliegue), esta
// pantalla no puede depender de otro fragmento (el del diccionario de inglés). Solo estas cinco frases.
const EN: Record<string, string> = {
  "Algo ha fallado": "Something went wrong",
  "El error ha quedado registrado. Prueba a recargar.": "The error has been recorded. Try reloading.",
  Reintentar: "Retry",
  Recargar: "Reload",
  "Volver a iniciar sesión": "Back to sign in",
};

/** Error en el propio layout raíz: se registra y se ofrece recargar. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    handleBoundaryError("global-error", error);
  }, [error]);
  // Sin proveedor (el layout raíz ha fallado): el idioma se deduce del navegador.
  const locale = useSyncExternalStore<Locale>(
    () => () => {},
    () => (/^en\b/i.test(navigator.language) ? "en" : "es"),
    () => "es",
  );
  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <Content reset={reset} locale={locale} />
      </body>
    </html>
  );
}

function Content({ reset, locale }: { reset: () => void; locale: Locale }) {
  const t = (s: string) => (locale === "en" ? (EN[s] ?? s) : s);
  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 18, fontWeight: 600 }}>{t("Algo ha fallado")}</p>
      <p style={{ color: "#64748b", fontSize: 14 }}>{t("El error ha quedado registrado. Prueba a recargar.")}</p>
      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={reset} style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "#4f46e5", color: "#fff" }}>{t("Reintentar")}</button>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "transparent", color: "inherit" }}>{t("Recargar")}</button>
      </div>
      {/* Enlace normal (navegación completa): borra sesión, verificación y dispositivo y lleva a /login, aunque la sesión esté rota. */}
      <p style={{ marginTop: 14, fontSize: 14 }}><a href="/api/auth/reset" style={{ color: "#4f46e5" }}>{t("Volver a iniciar sesión")}</a></p>
    </div>
  );
}
