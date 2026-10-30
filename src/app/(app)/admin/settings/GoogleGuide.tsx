"use client";

import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { GoogleSettingsView } from "@/lib/google-config";

/** Fila con un valor y su botón «Copiar» (direcciones, dominio…). */
export function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t("No se pudo copiar. Selecciónala y cópiala a mano."), "error");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-40 shrink-0 text-xs text-slate-500">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{value}</code>
      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={copy} aria-label={t("Copiar") + " " + label}>
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("Copiada") : t("Copiar")}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <details className="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40" data-testid={`google-step-${n}`}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {t("Paso {n}", { n })} · {title}
      </summary>
      <div className="space-y-2 border-t border-slate-200 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">{children}</div>
    </details>
  );
}

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

/** Guía paso a paso (una pantalla de Google Cloud por paso) para conseguir el ID y el secreto de cliente OAuth. */
export function GoogleGuide({ view, open }: { view: GoogleSettingsView; open: boolean }) {
  const t = useT();
  const { appUrl, appDomain, redirectUris } = view;
  return (
    <details className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300" open={open} data-testid="google-guide">
      <summary className="cursor-pointer text-sm font-medium">{t("Guía paso a paso: cómo conseguir el ID y el secreto de cliente (gratis, sin facturación)")}</summary>
      <div className="mt-3 space-y-2">
        <p>{t("Google Cloud usa ahora la interfaz «Google Auth Platform», con las secciones Overview, Branding, Audience, Clients, Data Access, Verification Center y Settings (si tu consola está en español, los nombres aparecen traducidos). Cada paso de abajo corresponde a una de esas pantallas. Abre solo el que necesites.")}</p>

        <Step n={1} title={t("Crear o elegir un proyecto")}>
          <p>{t("Entra en {site} con una cuenta de Google. Arriba, en el selector de proyectos, pulsa «Proyecto nuevo» (por ejemplo «Pizarro») o elige uno que ya tengas. Es gratis y no hace falta activar la facturación.", { site: "console.cloud.google.com" })}</p>
          <p><Ext href="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</Ext></p>
          <p>{t("Después abre «Google Auth Platform» (puedes buscarlo en la barra superior). Si es la primera vez, pulsa «Get started» / «Comenzar»: te pedirá lo del paso siguiente.")}</p>
        </Step>

        <Step n={2} title={t("Branding (marca de la aplicación)")}>
          <p>{t("En «Branding» (o en el asistente «Get started») rellena estos datos. Es lo que verá la gente en la pantalla de Google al entrar.")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Nombre de la aplicación: por ejemplo «Pizarro».")}</li>
            <li>{t("Email de asistencia al usuario: tu email o el de quien administre Pizarro.")}</li>
            <li>
              {t("Logotipo (opcional): déjalo vacío salvo que la aplicación sea «Interna» o esté en modo «Prueba». En una aplicación «Externa» ya publicada, subir un logotipo obliga a que Google la verifique.")}{" "}
              <a className="inline-flex items-center gap-1 underline" href="/pizarro-logo-120.png" download="pizarro-logo-120.png"><Download size={12} /> {t("Descargar logo de Pizarro (120×120 PNG)")}</a>
            </li>
          </ul>
          {appUrl ? (
            <div className="space-y-1.5">
              <CopyRow label={t("Página principal")} value={appUrl} />
              <CopyRow label={t("Política de privacidad")} value={`${appUrl}/privacy`} />
              <CopyRow label={t("Condiciones del servicio")} value={`${appUrl}/terms`} />
            </div>
          ) : (
            <p className="text-amber-600">{t("Define APP_URL en el servidor (por ejemplo https://pizarro.tuempresa.com) para ver las direcciones.")}</p>
          )}
          <p>{t("Pega esas tres direcciones en «Application home page», «Application privacy policy link» y «Application terms of service link». Las dos últimas son páginas públicas de Pizarro (puedes poner tu email de contacto en el campo de más abajo).")}</p>
          {appDomain.kind === "ok" && (
            <>
              <p>{t("«Authorized domains» (dominios autorizados): el dominio principal de tu dirección, sin «https://» ni subdominios.")}</p>
              <CopyRow label={t("Dominio autorizado")} value={appDomain.domain} />
            </>
          )}
          {appDomain.kind === "shared" && (
            <>
              <p className="text-amber-600 dark:text-amber-400">{t("Tu dirección ({host}) es un subdominio de un servicio de alojamiento compartido. Google pide como dominio autorizado un dominio que sea tuyo, y de los de alojamiento compartido no suele aceptarlo. No estoy seguro de la regla exacta de Google en cada caso: lo más fiable es usar un dominio propio (y poner su dirección en APP_URL). Si pruebas con este, el dominio sería:", { host: appDomain.host })}</p>
              <CopyRow label={t("Dominio autorizado")} value={appDomain.domain} />
            </>
          )}
          {appDomain.kind === "local" && <p className="text-amber-600 dark:text-amber-400">{t("Tu dirección ({host}) es local o una IP: Google no la acepta como dominio autorizado. Para usar el acceso con Google necesitas un dominio propio con HTTPS en APP_URL.", { host: appDomain.host })}</p>}
          <p>{t("Email de contacto del desarrollador: el tuyo (Google avisa ahí de cambios en el proyecto). Guarda con «Siguiente» / «Guardar».")}</p>
        </Step>

        <Step n={3} title={t("Audience (público)")}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Tipo de usuario. «Interno»: solo cuentas de tu organización de Google Workspace (no necesita publicar ni verificar nada). «Externo»: cualquier cuenta de Google, incluido Gmail.")}</li>
            <li>{t("Estado de publicación (solo «Externo»). «Testing» (prueba): solo entran las cuentas que añadas en «Test users» (máximo 100), y los permisos de Drive caducan a los 7 días. «In production» (producción): pulsa «Publish app» y entra cualquier cuenta; para los permisos básicos no hace falta verificación.")}</li>
            <li>{t("Para añadir usuarios de prueba: en «Audience», sección «Test users» → «Add users» y escribe los emails de Google de cada persona. Sin esto, Google bloquea el acceso con «access_blocked».")}</li>
          </ul>
        </Step>

        <Step n={4} title={t("Data Access (permisos)")}>
          <p>{t("Pulsa «Add or remove scopes» y marca los permisos que usa Pizarro:")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Para entrar con Google: openid, email y profile (permisos básicos, no sensibles).")}</li>
            <li>{t("Para crear Docs y Sheets desde las tarjetas: https://www.googleapis.com/auth/drive.file (acceso solo a los archivos que crea o abre la propia Pizarro, no a todo tu Drive). Solo hace falta si vas a usar esa función.")}</li>
          </ul>
          <p>{t("Si la aplicación es «Externa» y está en producción, Google puede pedir verificación por el permiso de Drive. Si no la quieres pasar, deja la aplicación en «Testing» con tus usuarios de prueba o usa solo el acceso con Google, sin Docs ni Sheets.")}</p>
          <p>{t("Guarda con «Update» y luego «Save».")}</p>
        </Step>

        <Step n={5} title={t("Clients (crear el cliente OAuth)")}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("En «Clients» pulsa «Create client» / «Crear cliente».")}</li>
            <li>{t("Tipo de aplicación: «Web application». Nombre: por ejemplo «Pizarro».")}</li>
            <li>{t("En «Authorized redirect URIs» pulsa «Add URI» y añade estas dos direcciones, exactamente como aparecen (con «https», sin barra final):")}</li>
          </ol>
          {redirectUris ? (
            <div className="space-y-1.5">
              <CopyRow label={t("Acceso con Google")} value={redirectUris.login} />
              <CopyRow label={t("Docs y Sheets")} value={redirectUris.docs} />
            </div>
          ) : (
            <p className="text-amber-600">{t("Define APP_URL en el servidor (por ejemplo https://pizarro.tuempresa.com) para ver las direcciones.")}</p>
          )}
          <p>{t("Pulsa «Create». Google muestra el «Client ID» y el «Client secret»: cópialos (el secreto solo se ve completo ahora; si lo pierdes, crea uno nuevo en la ficha del cliente).")}</p>
        </Step>

        <Step n={6} title={t("Volver a Pizarro")}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("Pega el ID y el secreto de cliente en los campos de más abajo y pulsa «Guardar».")}</li>
            <li>{t("El estado pasa a «Activo» y aparece «Iniciar sesión con Google» en la pantalla de acceso.")}</li>
            <li>{t("Pruébalo: cierra sesión y entra con «Iniciar sesión con Google» con una cuenta cuyo email ya exista en Pizarro (si es una aplicación en «Testing», que además esté en «Test users»).")}</li>
          </ol>
        </Step>

        <Step n={7} title={t("Si algo falla")}>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{t("«redirect_uri_mismatch»: la dirección de redirección del cliente no coincide. Debe ser idéntica a las de arriba: https, sin barra final y sin espacios. Tras corregirla en Google pueden pasar unos minutos.")}</li>
            <li>{t("«access_blocked» / «app no verificada»: la aplicación está en «Testing» y esa cuenta no está en «Test users», o pide permisos sensibles sin verificar. Añade la cuenta o publica la aplicación.")}</li>
            <li>{t("«No hay ninguna cuenta con ese email»: Google ha ido bien, pero ese email no existe en Pizarro. Un administrador debe crear primero el usuario.")}</li>
            <li>{t("«Usa una cuenta de Google del dominio de la empresa»: has indicado un «Dominio de Workspace permitido» y esa cuenta es de otro dominio. Cámbialo o déjalo vacío.")}</li>
          </ul>
        </Step>
      </div>
    </details>
  );
}
