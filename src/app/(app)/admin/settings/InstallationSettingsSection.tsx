"use client";

import { Building2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveInstallationSettings } from "@/actions/settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { Locale } from "@/i18n/shared";
import { actionThrowResult } from "@/lib/stale-action";

export interface InstallationView {
  orgName: string;
  locale: Locale;
  timeZone: string;
  /** APP_TIMEZONE manda: la zona se muestra, pero no se puede cambiar aquí. */
  zoneLocked: boolean;
  zones: string[];
}

/** «Instalación»: lo que se eligió en el asistente de primer arranque (nombre, idioma por defecto y zona horaria). */
export function InstallationSettingsSection({ view }: { view: InstallationView }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState({ orgName: view.orgName, locale: view.locale, timeZone: view.timeZone });
  const [orgName, setOrgName] = useState(view.orgName);
  const [locale, setLocale] = useState<Locale>(view.locale);
  const [timeZone, setTimeZone] = useState(view.timeZone);
  const validName = orgName.trim() !== "" && orgName.trim().length <= 80;
  const dirty = orgName.trim() !== saved.orgName || locale !== saved.locale || (!view.zoneLocked && timeZone !== saved.timeZone);
  const zones = view.zones.includes(timeZone) ? view.zones : [timeZone, ...view.zones];

  const save = () =>
    start(async () => {
      const res = await saveInstallationSettings({ orgName, locale, timeZone }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      const zoneChanged = !view.zoneLocked && res.data.timeZone !== saved.timeZone;
      setSaved({ orgName: res.data.orgName, locale: res.data.locale, timeZone: view.zoneLocked ? saved.timeZone : res.data.timeZone });
      setOrgName(res.data.orgName);
      toast(t("Ajustes de la instalación guardados."), "success");
      // El navegador lee la zona horaria al cargar la página: con otra zona se recarga para que las fechas la usen ya.
      if (zoneChanged) window.location.reload();
    });

  return (
    <section id="instalacion" className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold"><Building2 size={16} /> {t("Instalación")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("Lo que se eligió en el asistente de configuración. El idioma por defecto es el de las pantallas sin sesión (acceso, enlaces de los emails) y el de las personas que invites; cada persona elige el suyo en «Mi perfil».")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">{t("Nombre de la organización")}</span>
          <input id="instance-org" className="input mt-1 w-full" value={orgName} maxLength={80} onChange={(e) => setOrgName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("Idioma por defecto")}</span>
          <select id="instance-locale" className="input mt-1 w-full" value={locale} onChange={(e) => setLocale(e.target.value === "en" ? "en" : "es")}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("Zona horaria")}</span>
          <select id="instance-tz" className="input mt-1 w-full" value={timeZone} disabled={view.zoneLocked} onChange={(e) => setTimeZone(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          {view.zoneLocked && <span className="mt-1 block text-xs text-slate-500">{t("Fijada por la variable APP_TIMEZONE del servidor.")}</span>}
        </label>
      </div>
      <p className="text-xs text-slate-500">{t("La zona horaria se usa para los plazos, los avisos y los informes de todos.")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty || !validName}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        {!validName && dirty && <span className="text-xs text-red-600">{t("Escribe el nombre de la organización (hasta 80 caracteres).")}</span>}
      </div>
    </section>
  );
}
