"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveGoogleSettings } from "@/actions/google-settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { GoogleSettingsView } from "@/lib/google-config";
import { actionThrowResult } from "@/lib/stale-action";
import { CopyRow, GoogleGuide } from "./GoogleGuide";

/** «Acceso con Google»: ID y secreto de cliente OAuth guardados en Pizarro (o, si el servidor define GOOGLE_*, solo lectura). */
export function GoogleSettingsSection({ view }: { view: GoogleSettingsView }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(view.settings);
  const [clientId, setClientId] = useState(view.settings.clientId);
  const [domain, setDomain] = useState(view.settings.workspaceDomain);
  const [contact, setContact] = useState(view.settings.publicContactEmail);
  const [secret, setSecret] = useState("");
  const [replacing, setReplacing] = useState(!view.settings.hasSecret);

  const dirty = clientId.trim() !== saved.clientId || domain.trim().toLowerCase().replace(/^@/, "") !== saved.workspaceDomain || secret !== "" || contact.trim() !== saved.publicContactEmail;
  const idChanged = saved.hasSecret && clientId.trim() !== saved.clientId && clientId.trim() !== "";

  const save = (disable = false) =>
    start(async () => {
      const res = await saveGoogleSettings({ clientId: disable ? "" : clientId, workspaceDomain: domain, publicContactEmail: contact, secret: disable ? "" : secret }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      const s = res.data.settings;
      setSaved(s);
      setClientId(s.clientId);
      setDomain(s.workspaceDomain);
      setContact(s.publicContactEmail);
      setSecret("");
      setReplacing(!s.hasSecret);
      toast(s.clientId ? t("Configuración de Google guardada.") : t("Acceso con Google desactivado."), "success");
      router.refresh();
    });

  const status = view.active ? (
    <p className="rounded-md bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
      {t("Activo: aparece «Iniciar sesión con Google» en la pantalla de acceso.")}
    </p>
  ) : (
    <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      {view.appUrlMissing ? t("Inactivo: falta la variable APP_URL del servidor (la dirección pública de Pizarro).") : t("Inactivo: no aparece «Iniciar sesión con Google» hasta que guardes el ID y el secreto de cliente.")}
    </p>
  );

  return (
    <section id="acceso-google" className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold"><KeyRound size={16} /> {t("2. Acceso con Google")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {t("Permite entrar con «Iniciar sesión con Google» a las personas que ya tienen cuenta en Pizarro con ese mismo email. También se usa para crear Docs y Sheets desde las tarjetas. No envía ningún email: eso es la sección 1.")}
        </p>
      </div>
      {status}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Direcciones de redirección")}</h3>
        <p className="text-xs text-slate-500">{t("Pégalas en Google Cloud al crear el cliente OAuth (en «URI de redirección autorizados»).")}</p>
        {view.redirectUris ? (
          <div className="space-y-1.5">
            <CopyRow label={t("Acceso con Google")} value={view.redirectUris.login} />
            <CopyRow label={t("Docs y Sheets")} value={view.redirectUris.docs} />
          </div>
        ) : (
          <p className="text-xs text-amber-600">{t("Define APP_URL en el servidor (por ejemplo https://pizarro.tuempresa.com) para ver las direcciones.")}</p>
        )}
      </div>

      <GoogleGuide view={view} open={!saved.clientId && !view.envCredentials} />

      {view.envCredentials ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{t("El ID y el secreto de cliente están configurados en el servidor (variables GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET). Para cambiarlos hay que editar las variables del servicio; aquí solo se muestra.")}</p>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-slate-500">{t("ID de cliente")}</dt><dd>{t("configurado en el servidor")}</dd>
            <dt className="text-slate-500">{t("Secreto de cliente")}</dt><dd>{t("configurado en el servidor")}</dd>
          </dl>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{t("ID de cliente")}</span>
            <input className="input mt-1 w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc.apps.googleusercontent.com" autoComplete="off" maxLength={200} />
          </label>
          <div className="block text-sm">
            <label htmlFor="google-secret" className="font-medium">{t("Secreto de cliente")}</label>
            {saved.hasSecret && !replacing ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{t("guardado")}</span>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setReplacing(true)}>{t("Reemplazar")}</button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => save(true)} disabled={pending}>{t("Quitar")}</button>
              </div>
            ) : (
              <input id="google-secret" className="input mt-1 w-full" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" maxLength={500} placeholder={saved.hasSecret ? t("Secreto nuevo") : ""} />
            )}
            {idChanged && secret === "" && <p className="mt-1 text-xs text-amber-600">{t("Si cambias el ID de cliente, escribe también el secreto.")}</p>}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">{t("Dominio de Workspace permitido (opcional)")}</span>
          {view.envDomain ? (
            <span className="mt-1 block text-xs text-slate-500">{t("Configurado en el servidor (GOOGLE_WORKSPACE_DOMAIN).")}</span>
          ) : (
            <input className="input mt-1 w-full" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="empresa.com" autoComplete="off" maxLength={253} />
          )}
          <span className="mt-1 block text-xs text-slate-500">{t("Vacío = vale cualquier cuenta de Google, también Gmail. Con un dominio, solo entran cuentas de ese dominio, y se puede compartir Docs y Sheets con todo el dominio.")}</span>
        </label>
      </div>

      {!view.envCredentials && (
      <label className="block text-sm sm:max-w-md">
        <span className="font-medium">{t("Email de contacto público (opcional)")}</span>
        <input className="input mt-1 w-full" type="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="privacidad@empresa.com" autoComplete="off" maxLength={200} />
        <span className="mt-1 block text-xs text-slate-500">{t("Aparece en las páginas públicas de privacidad y condiciones (/privacy y /terms) que Google pide. Vacío = «el administrador de esta instalación».")}</span>
      </label>
      )}

      {!view.envCredentials && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary py-1.5" onClick={() => save()} disabled={pending || !dirty}>
            {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
          </button>
          {saved.clientId !== "" && (
            <button className="btn-secondary py-1.5" onClick={() => save(true)} disabled={pending}>{t("Desactivar el acceso con Google")}</button>
          )}
        </div>
      )}
    </section>
  );
}
