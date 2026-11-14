"use client";

import { Check, Smartphone } from "lucide-react";
import { useState } from "react";
import { saveAppIcon } from "@/actions/settings";
import { cn } from "@/components/ui/cn";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useActionTransition } from "@/components/useActionTransition";
import { useT } from "@/i18n/client";
import { APP_ICON_ACCENTS, APP_ICON_LABEL, appIconUrl, appNames, type AppIconAccent } from "@/lib/app-icon-core";

/**
 * «Icono de la app»: el color del icono de esta instalación (pestaña del navegador, pantalla de inicio del móvil y app
 * instalada) y el nombre que lleva debajo. Sirve para distinguir dos instalaciones de Pizarro en el mismo móvil (p. ej.
 * la del trabajo y la personal). Se guarda al elegirlo.
 */
export function AppIconSettingsSection({ initial, orgName }: { initial: AppIconAccent; orgName: string }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [accent, setAccent] = useState(initial);
  const { shortName } = appNames(orgName);

  const choose = (value: AppIconAccent) => {
    if (value === accent || pending) return;
    const previous = accent;
    setAccent(value);
    start(async () => {
      const res = await saveAppIcon(value);
      if (!res.ok) {
        setAccent(previous);
        return toast(res.error, "error");
      }
      toast(t("Color del icono guardado."), "success");
    });
  };

  return (
    <section id="icono-app" className="card space-y-4 p-5" data-app-icon-settings>
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Smartphone size={16} /> {t("Icono de la app")}
          <InfoTip topic={t("Icono de la app")}>
            {t("El de la pestaña del navegador y el de la app instalada en el móvil o el ordenador. Con un color distinto en cada instalación de Pizarro (p. ej. la del trabajo y la personal), se distinguen a simple vista. Cada persona sigue eligiendo el tema de color de la app en «Mi perfil».")}
          </InfoTip>
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {t("Con el nombre de la organización debajo: «{name}».", { name: shortName })}
        </p>
      </div>
      <div role="radiogroup" aria-label={t("Color del icono de la app")} className="flex flex-wrap gap-3">
        {APP_ICON_ACCENTS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={accent === value}
            onClick={() => choose(value)}
            data-app-icon={value}
            className={cn(
              "flex w-20 flex-col items-center gap-1.5 rounded-xl p-2 text-xs transition-colors",
              accent === value ? "bg-slate-100 font-semibold ring-2 ring-slate-900 dark:bg-slate-800 dark:ring-slate-100" : "text-slate-600 ring-1 ring-transparent hover:ring-slate-300 dark:text-slate-400 dark:hover:ring-slate-600",
            )}
          >
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- icono pequeño servido por la propia app, sin optimizar */}
              <img src={appIconUrl(value, "icon.svg")} alt="" width={44} height={44} className="h-11 w-11" />
              {accent === value && (
                <span className="absolute -right-1.5 -bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white ring-2 ring-white dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-900">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </span>
            {t(APP_ICON_LABEL[value])}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {t("La pestaña cambia al recargar. En Android, la app ya instalada se actualiza sola al cabo de un tiempo (a veces lo pide); en iPhone y iPad hay que quitarla de la pantalla de inicio y volver a añadirla.")}
      </p>
    </section>
  );
}
