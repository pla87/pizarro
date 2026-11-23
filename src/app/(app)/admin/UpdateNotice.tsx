"use client";

import { ArrowUpCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissUpdate } from "@/actions/update-notice";
import { useLocale, useT } from "@/i18n/client";
import { actionThrowResult } from "@/lib/stale-action";
import type { SetupCodeSource } from "@/lib/setup-core";
import { updateDocsUrl } from "@/lib/update-check-core";

/** Cómo se actualiza cada instalación (la misma detección que el paso 1 de /setup, setupCodeSource). */
function howToUpdate(platform: SetupCodeSource, t: ReturnType<typeof useT>): string {
  switch (platform) {
    case "railway":
      return t("En Railway se actualiza solo si el servicio despliega desde la rama stable; si no, en el servicio pulsa ⌘K (Ctrl+K) → Deploy Latest Commit.");
    case "render":
      return t("En Render: en el servicio, Manual Deploy → Deploy latest reference (descarga la imagen latest).");
    case "fly":
      return t("En Fly.io: ejecuta fly deploy en la carpeta de tu fly.toml (descarga la imagen latest).");
    case "npm":
      return t("Con npm start: descarga el código de la versión nueva (rama stable), ejecuta npm ci, npx prisma migrate deploy y npm run build, y vuelve a arrancar.");
    default:
      return t("En tu servidor: vuelve a ejecutar el comando de instalación (get.sh) o «docker compose pull && docker compose up -d».");
  }
}

/** Aviso discreto de versión nueva (solo administradores). Se oculta por versión. */
export function UpdateNotice({ version, url, platform }: { version: string; url: string; platform: SetupCodeSource }) {
  const t = useT();
  const locale = useLocale();
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
          <a className={link} href={updateDocsUrl(locale)} target="_blank" rel="noopener noreferrer">{t("Cómo actualizar")}</a>
        </p>
        <p className="text-xs opacity-80">{howToUpdate(platform, t)}</p>
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
