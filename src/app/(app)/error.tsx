"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/clientErrors";
import { useT } from "@/i18n/client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  // Todo error que llega aquí queda en Administración → Logs (con su «digest» para cruzarlo con el del servidor).
  useEffect(() => reportClientError("error-boundary", error, error.digest), [error]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">{t("Algo ha fallado")}</p>
      <p className="text-sm text-slate-500">{t("Inténtalo de nuevo. El error ha quedado registrado en los logs.")}</p>
      <button onClick={reset} className="btn-primary">{t("Reintentar")}</button>
    </div>
  );
}
