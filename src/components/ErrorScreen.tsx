"use client";

import { useEffect } from "react";
import { handleBoundaryError } from "@/components/clientErrors";
import { useT } from "@/i18n/client";

/** Pantalla de error común de las rutas (con y sin sesión): reintentar, recargar entera y volver a iniciar sesión. */
export function ErrorScreen({ error, reset, className }: { error: Error & { digest?: string }; reset: () => void; className: string }) {
  const t = useT();
  // Todo error que llega aquí queda en Administración → Logs (con su «digest» para cruzarlo con el del servidor).
  // Si es de una versión anterior (tras un despliegue), se recarga la página en lugar de enseñarlo.
  useEffect(() => {
    handleBoundaryError("error-boundary", error);
  }, [error]);
  return (
    <div className={className}>
      <p className="text-lg font-semibold">{t("Algo ha fallado")}</p>
      <p className="text-sm text-slate-500">{t("Inténtalo de nuevo. El error ha quedado registrado en los logs.")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="btn-primary">{t("Reintentar")}</button>
        <button onClick={() => window.location.reload()} className="btn-secondary">{t("Recargar")}</button>
      </div>
      {/* Enlace normal (no <Link>): navegación completa que borra sesión, verificación y dispositivo y lleva a /login. */}
      <a href="/api/auth/reset" className="text-sm text-brand-700 hover:underline dark:text-brand-300">{t("Volver a iniciar sesión")}</a>
    </div>
  );
}
