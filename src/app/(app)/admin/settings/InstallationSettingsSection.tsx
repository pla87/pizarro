"use client";

import { Building2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveInstallationSettings } from "@/actions/settings";
import { EditConflictNotice } from "@/components/ui/EditConflictNotice";
import { InfoTip } from "@/components/ui/InfoTip";
import { TimeZoneField } from "@/components/ui/TimeZoneField";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { Locale } from "@/i18n/shared";
import { isEditConflict } from "@/lib/edit-conflict-core";
import { actionThrowResult } from "@/lib/stale-action";
import type { AppUrlSource } from "@/lib/app-url";

export interface InstallationView {
  orgName: string;
  locale: Locale;
  timeZone: string;
  /** APP_TIMEZONE manda: la zona se muestra como texto, sin selector (y `zones` va vacía). */
  zoneLocked: boolean;
  zones: string[];
  /** Dirección pública (APP_URL) y de dónde sale: la variable, la de Railway (RAILWAY_PUBLIC_DOMAIN) o ninguna. */
  appUrl: string | null;
  appUrlSource: AppUrlSource;
}

/** «Instalación»: lo que se eligió en el asistente de primer arranque (nombre, idioma por defecto y zona horaria). */
export function InstallationSettingsSection({ view, version: initialVersion }: { view: InstallationView; version: string }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState({ orgName: view.orgName, locale: view.locale, timeZone: view.timeZone });
  const [orgName, setOrgName] = useState(view.orgName);
  const [locale, setLocale] = useState<Locale>(view.locale);
  const [timeZone, setTimeZone] = useState(view.timeZone);
  const [version, setVersion] = useState(initialVersion);
  const [conflict, setConflict] = useState(false);
  const validName = orgName.trim() !== "" && orgName.trim().length <= 80;
  // "" mientras lo escrito en la zona no es ninguna de la lista.
  const validZone = view.zoneLocked || timeZone !== "";
  const dirty = orgName.trim() !== saved.orgName || locale !== saved.locale || (!view.zoneLocked && timeZone !== saved.timeZone);

  const save = () =>
    start(async () => {
      const res = await saveInstallationSettings({ orgName, locale, timeZone, since: version }).catch((e) => actionThrowResult(e, t));
      if (isEditConflict(res)) return setConflict(true);
      if (!res.ok) return toast(res.error, "error");
      setConflict(false);
      setVersion(res.data.version);
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
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Building2 size={16} /> {t("Instalación")}
          <InfoTip topic={t("Instalación")}>{t("El idioma por defecto es el de las pantallas sin sesión y el de quien invites; cada persona elige el suyo en «Mi perfil». La zona horaria vale para los plazos, avisos e informes de todos.")}</InfoTip>
        </h2>
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
        {view.zoneLocked ? (
          // Fijada por APP_TIMEZONE: no se puede cambiar aquí, así que se muestra como texto (sin la lista de ~400 zonas).
          <div className="text-sm">
            <span className="font-medium">{t("Zona horaria")}</span>
            <p id="instance-tz" className="mt-1 py-1.5 font-mono text-sm">{timeZone}</p>
            <span className="block text-xs text-slate-500">{t("Fijada por la variable APP_TIMEZONE del servidor.")}</span>
          </div>
        ) : (
          <div className="block text-sm">
            <label htmlFor="instance-tz" className="font-medium">{t("Zona horaria")}</label>
            <TimeZoneField id="instance-tz" className="input mt-1 w-full" value={timeZone} options={view.zones} onChange={setTimeZone} />
          </div>
        )}
      </div>
      <div className="text-sm" data-testid="instance-app-url">
        <span className="font-medium">{t("Dirección pública (APP_URL)")}</span>
        {view.appUrl && <p className="mt-1 break-all font-mono text-sm">{view.appUrl}</p>}
        <span className={`block text-xs ${view.appUrlSource === "none" ? "mt-1 text-amber-700 dark:text-amber-300" : "text-slate-500"}`}>
          {view.appUrlSource === "env"
            ? t("Fijada por la variable APP_URL del servidor.")
            : view.appUrlSource === "railway"
              ? t("Sin APP_URL: es la dirección pública que da Railway (RAILWAY_PUBLIC_DOMAIN). Si usas un dominio propio, define APP_URL en Variables y vuelve a desplegar.")
              : view.appUrlSource === "render"
                ? t("Sin APP_URL: es la dirección pública que da Render (RENDER_EXTERNAL_URL). Si usas un dominio propio, define APP_URL en Environment y vuelve a desplegar.")
                : view.appUrlSource === "fly"
                  ? t("Sin APP_URL: es la dirección pública que da Fly.io (https://<app>.fly.dev). Si usas un dominio propio, define APP_URL con fly secrets set.")
                  : t("Sin definir: los enlaces de los emails llevarán a http://localhost:3000. Define APP_URL en el servidor (por ejemplo https://pizarro.example.com) y vuelve a arrancar.")}
        </span>
      </div>
      {conflict && <EditConflictNotice draft={[orgName, locale, view.zoneLocked ? "" : timeZone].filter(Boolean).join("\n")} />}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty || !validName || !validZone}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        {!validName && dirty && <span className="text-xs text-red-600">{t("Escribe el nombre de la organización (hasta 80 caracteres).")}</span>}
      </div>
    </section>
  );
}
