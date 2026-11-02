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
export function GoogleGuide({ view }: { view: GoogleSettingsView }) {
  const t = useT();
  const { appUrl, appDomain, redirectUris } = view;
  return (
    <details className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300" data-testid="google-guide">
      <summary className="cursor-pointer text-sm font-medium">{t("Guía: conseguir el ID y el secreto de cliente (gratis)")}</summary>
      <div className="mt-3 space-y-2">
        <p>{t("Usa la interfaz «Google Auth Platform» (Overview, Branding, Audience, Clients, Data Access…; en español salen traducidas). Cada paso es una de sus pantallas: abre solo el que necesites.")}</p>

        <Step n={0} title={t("¿Dominio propio o la dirección del servidor?")}>
          <p>{t("Decide con qué dirección entrará tu gente: es APP_URL y de ella salen los valores de los pasos siguientes.")}</p>
          <p className="font-medium">{t("A) La dirección del servidor (p. ej. https://algo.up.railway.app)")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Gratis y sin configurar DNS.")}</li>
            <li>{t("Google suele aceptar la dirección completa como «dominio autorizado» (paso 2).")}</li>
            <li>{t("Se ve menos profesional y, si luego cambias a dominio propio, hay que actualizar Google.")}</li>
          </ul>
          <p className="font-medium">{t("B) Dominio propio (p. ej. https://pizarro.example.com), recomendado")}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("Añade el dominio en tu alojamiento. Railway: servicio → Settings → Networking → Custom Domain. Docker Compose: registro DNS A/AAAA hacia la IP del servidor y ese dominio en DOMAIN (Caddy pide el certificado).")}</li>
            <li>{t("Crea el registro DNS que indique el alojamiento (en Railway, un CNAME) y espera al HTTPS (minutos u horas).")}</li>
            <li>{t("Pon en APP_URL la dirección nueva (https://, sin barra final) y redespliega. Railway: Variables → APP_URL → Redeploy. Docker Compose: edita deploy/.env y ejecuta docker compose up -d.")}</li>
            <li>{t("Vuelve aquí: verás la dirección nueva y los valores para Google ya calculados. Sigue los pasos 1 a 6.")}</li>
          </ol>
          <p>{t("El «dominio autorizado» es el dominio registrable (example.com), sin subdominios ni «https://».")}</p>
          <p className="font-medium">{t("Cambiar de opción más adelante")}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("En «Clients» añade las nuevas direcciones de redirección sin borrar las antiguas (Google admite varias). Esta pantalla muestra ambas si entras por una dirección distinta de APP_URL.")}</li>
            <li>{t("En «Branding» cambia la página principal, los enlaces de privacidad y condiciones y los dominios autorizados.")}</li>
            <li>{t("Comprueba el acceso con la dirección nueva y borra las antiguas.")}</li>
            <li>{t("Avisa a tu gente: deberá iniciar sesión de nuevo, y quien instaló Pizarro como aplicación debe reinstalarla desde la dirección nueva.")}</li>
          </ol>
        </Step>

        <Step n={1} title={t("Crear o elegir un proyecto")}>
          <p>{t("Entra en {site}, pulsa «Proyecto nuevo» (p. ej. «Pizarro») en el selector de proyectos o elige uno existente. Es gratis, sin facturación.", { site: "console.cloud.google.com" })}</p>
          <p><Ext href="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</Ext></p>
          <p>{t("Abre «Google Auth Platform» (búscalo arriba). La primera vez pulsa «Get started» / «Comenzar».")}</p>
        </Step>

        <Step n={2} title={t("Branding (marca de la aplicación)")}>
          <p>{t("En «Branding» (o en «Get started») rellena lo que verá la gente al entrar.")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Nombre de la aplicación: p. ej. «Pizarro».")}</li>
            <li>{t("Email de asistencia al usuario: el tuyo o el de quien administre Pizarro.")}</li>
            <li>
              {t("Logotipo (opcional): déjalo vacío salvo en apps «Internas» o en «Prueba»; en una «Externa» publicada obliga a que Google la verifique.")}{" "}
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
          <p>{t("Pégalas en «Application home page», «Application privacy policy link» y «Application terms of service link». Las dos últimas son páginas públicas de Pizarro.")}</p>
          {appDomain.kind === "ok" && (
            <>
              <p>{t("«Authorized domains»: el dominio principal de tu dirección, sin «https://» ni subdominios.")}</p>
              <CopyRow label={t("Dominio autorizado")} value={appDomain.domain} />
            </>
          )}
          {appDomain.kind === "shared" && (
            <>
              <p className="text-amber-600 dark:text-amber-400">{t("Tu dirección ({host}) es un subdominio de un alojamiento compartido: Google suele aceptar la dirección completa como dominio autorizado (abajo). Si la rechaza, o para mostrar tu marca, usa un dominio propio en APP_URL. Dominio a escribir:", { host: appDomain.host })}</p>
              <CopyRow label={t("Dominio autorizado")} value={appDomain.domain} />
            </>
          )}
          {appDomain.kind === "local" && <p className="text-amber-600 dark:text-amber-400">{t("Tu dirección ({host}) es local o una IP: Google no la acepta. Necesitas un dominio propio con HTTPS en APP_URL.", { host: appDomain.host })}</p>}
          <p>{t("Email de contacto del desarrollador: el tuyo. Guarda con «Siguiente» / «Guardar».")}</p>
        </Step>

        <Step n={3} title={t("Audience (público)")}>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Tipo de usuario. «Interno»: solo tu organización de Google Workspace (sin publicar ni verificar). «Externo»: cualquier cuenta de Google, incluido Gmail.")}</li>
            <li>{t("Publicación (solo «Externo»). «Testing»: solo entran las cuentas de «Test users» (máx. 100) y los permisos de Drive caducan a los 7 días. «In production»: pulsa «Publish app» y entra cualquiera; los permisos básicos no requieren verificación.")}</li>
            <li>{t("Usuarios de prueba: «Audience» → «Test users» → «Add users» con sus emails de Google. Sin esto, Google bloquea con «access_blocked».")}</li>
          </ul>
        </Step>

        <Step n={4} title={t("Data Access (permisos)")}>
          <p>{t("Pulsa «Add or remove scopes» y marca:")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Entrar con Google: openid, email y profile (básicos).")}</li>
            <li>{t("Docs y Sheets desde las tarjetas: https://www.googleapis.com/auth/drive.file (solo los archivos que crea o abre Pizarro, no todo tu Drive). Solo si usas esa función.")}</li>
          </ul>
          <p>{t("Una app «Externa» en producción puede requerir verificación por el permiso de Drive. Para evitarla, déjala en «Testing» o usa solo el acceso con Google, sin Docs ni Sheets.")}</p>
          <p>{t("Guarda con «Update» y «Save».")}</p>
        </Step>

        <Step n={5} title={t("Clients (crear el cliente OAuth)")}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("En «Clients» pulsa «Create client» / «Crear cliente».")}</li>
            <li>{t("Tipo «Web application»; nombre p. ej. «Pizarro».")}</li>
            <li>{t("En «Authorized redirect URIs» → «Add URI» añade estas dos, tal cual (https, sin barra final):")}</li>
          </ol>
          {redirectUris ? (
            <div className="space-y-1.5">
              <CopyRow label={t("Acceso con Google")} value={redirectUris.login} />
              <CopyRow label={t("Docs y Sheets")} value={redirectUris.docs} />
              {view.mismatch && (
                <>
                  <p className="pt-1">{t("Si migras de dirección, añade también estas (la actual, {current}):", { current: view.mismatch.current })}</p>
                  <CopyRow label={t("Acceso con Google")} value={view.mismatch.redirectUris.login} />
                  <CopyRow label={t("Docs y Sheets")} value={view.mismatch.redirectUris.docs} />
                </>
              )}
            </div>
          ) : (
            <p className="text-amber-600">{t("Define APP_URL en el servidor (por ejemplo https://pizarro.tuempresa.com) para ver las direcciones.")}</p>
          )}
          <p>{t("Pulsa «Create» y copia el «Client ID» y el «Client secret» (el secreto solo se ve completo ahora; si lo pierdes, crea otro).")}</p>
        </Step>

        <Step n={6} title={t("Volver a Pizarro")}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("Pega el ID y el secreto en los campos de abajo y pulsa «Guardar».")}</li>
            <li>{t("El estado pasa a «Activo» y aparece «Iniciar sesión con Google» en el acceso.")}</li>
            <li>{t("Pruébalo con una cuenta cuyo email ya exista en Pizarro (en «Testing», que esté también en «Test users»).")}</li>
          </ol>
        </Step>

        <Step n={7} title={t("Si algo falla")}>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{t("«redirect_uri_mismatch»: la redirección del cliente no coincide. Debe ser idéntica a las de arriba (https, sin barra final ni espacios); tras corregirla pueden pasar unos minutos.")}</li>
            <li>{t("«access_blocked» / «app no verificada»: la app está en «Testing» y la cuenta no está en «Test users», o pide permisos sensibles sin verificar. Añade la cuenta o publica la app.")}</li>
            <li>{t("«No hay ninguna cuenta con ese email»: Google fue bien, pero ese email no existe en Pizarro. Crea antes el usuario.")}</li>
            <li>{t("«Usa una cuenta de Google del dominio de la empresa»: hay un «Dominio de Workspace permitido» y la cuenta es de otro. Cámbialo o déjalo vacío.")}</li>
          </ul>
        </Step>
      </div>
    </details>
  );
}
