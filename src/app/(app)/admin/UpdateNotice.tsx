"use client";

import { ArrowUpCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissUpdate } from "@/actions/update-notice";
import { useT } from "@/i18n/client";
import { actionThrowResult } from "@/lib/stale-action";
import { UPDATE_DOCS_URL } from "@/lib/update-check-core";

/** Aviso discreto de versión nueva (solo administradores). Se oculta por versión. */
export function UpdateNotice({ version, url, railway }: { version: string; url: string; railway: boolean }) {
  const t = useT();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  if (hidden) return null;
  const link = "font-medium underline underline-offset-2";
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          {t("Hay una versión nueva de Pizarro: v{version}", { version })}
          {" · "}
          <a className={link} href={url} target="_blank" rel="noopener noreferrer">{t("Ver novedades")}</a>
          {" · "}
          <a className={link} href={UPDATE_DOCS_URL} target="_blank" rel="noopener noreferrer">{t("Cómo actualizar")}</a>
        </p>
        <p className="text-xs opacity-80">
          {railway
            ? t("En Railway: vuelve a desplegar desde GitHub (Deployments → Redeploy).")
            : t("En tu servidor: vuelve a ejecutar el comando de instalación (get.sh) o «docker compose pull && docker compose up -d».")}
        </p>
      </div>
      <button
        type="button"
        className="rounded p-1 hover:bg-sky-100 dark:hover:bg-sky-900/50"
        aria-label={t("Ocultar este aviso")}
        title={t("Ocultar este aviso")}
        onClick={() => {
          setHidden(true);
          start(async () => {
            await dismissUpdate(version).catch((e) => actionThrowResult(e, t));
            router.refresh();
          });
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
