"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { completeSetupAction, sendSetupTestEmail, verifySetupCodeAction } from "@/actions/setup";
import { BrandMark } from "@/components/ui/BrandMark";
import { InfoTip } from "@/components/ui/InfoTip";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { I18nProvider, preloadEnglish, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/core";
import type { SetupCodeSource } from "@/lib/setup-core";
import { useActionTransition } from "@/components/useActionTransition";

interface Props {
  zones: string[];
  defaultZone: string;
  /** APP_TIMEZONE manda: la zona no se puede cambiar aquí. */
  zoneLocked: boolean;
  smtp: boolean;
  /** Dónde se ve el código de configuración según cómo se arrancó el servidor. */
  codeSource: SetupCodeSource;
}

const STEPS = 5;

export function SetupWizard(props: Props) {
  // El idioma elegido en el paso 2 cambia ya los textos del propio asistente. I18nProvider pinta siempre el mismo árbol,
  // así que el cambio no desmonta <Wizard> (antes volvía al paso 1 y se perdía lo escrito). En una transición: mientras
  // llega el diccionario de inglés se sigue viendo el asistente tal cual.
  const [lang, setLangState] = useState<Locale>("es");
  const setLang = (l: Locale) => {
    if (l === "en") preloadEnglish().catch(() => {});
    startTransition(() => setLangState(l));
  };
  return (
    <I18nProvider locale={lang}>
      <Wizard {...props} lang={lang} setLang={setLang} />
    </I18nProvider>
  );
}

/** Texto del paso 1: dónde está el código según la instalación. */
function codeHint(source: SetupCodeSource, t: ReturnType<typeof useT>): string {
  switch (source) {
    case "docker":
      return t("Escribe el código de configuración que te dio el instalador o que aparece en el log del contenedor (docker compose logs app).");
    case "npm":
      return t("Escribe el código de configuración que aparece en la terminal donde ejecutaste npm start.");
    case "railway":
      return t("Escribe el código de configuración que aparece en los logs de Railway (servicio de la app → Deployments → View logs).");
    default:
      return t("Escribe el código de configuración que aparece en el log del servidor: con Docker, docker compose logs app; con npm start, la terminal; en Railway, los logs del despliegue.");
  }
}

function Wizard({ zones, defaultZone, zoneLocked, smtp, codeSource, lang, setLang }: Props & { lang: Locale; setLang: (l: Locale) => void }) {
  const t = useT();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [timeZone, setTimeZone] = useState(defaultZone);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useActionTransition(setError);

  const go = (n: number) => {
    setError(null);
    setInfo(null);
    setStep(n);
  };

  const submitCode = () =>
    start(async () => {
      setError(null);
      const res = await verifySetupCodeAction(code, lang);
      if (res.ok) go(2);
      else setError(res.error);
    });

  const sendTest = () =>
    start(async () => {
      setError(null);
      setInfo(null);
      const res = await sendSetupTestEmail(code, lang, adminEmail);
      if (res.ok) setInfo(t("Email de prueba enviado a {email}. Comprueba tu bandeja de entrada.", { email: adminEmail }));
      else setError(res.error);
    });

  const finish = () =>
    start(async () => {
      setError(null);
      const res = await completeSetupAction({ code, orgName, language: lang, timeZone, adminName, adminEmail, adminPassword });
      if (res.ok) {
        // La contraseña ya no se necesita en memoria.
        setAdminPassword("");
        go(5);
      } else setError(res.error);
    });

  const busy = pending ? <Loader2 size={16} className="animate-spin" /> : null;
  const errorBox = error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>;
  const infoBox = info && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300">{info}</p>;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <BrandMark size={36} />
          <span className="text-2xl font-bold tracking-tight">Pizarro</span>
        </div>
        <div className="card p-6">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("Paso {n} de {total}", { n: step, total: STEPS })}</p>

          {step === 1 && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submitCode(); }}>
              <h1 className="text-lg font-semibold">{t("Configurar Pizarro")}</h1>
              <p className="text-sm text-slate-500">{codeHint(codeSource, t)}</p>
              <div>
                <label className="label" htmlFor="setup-code">{t("Código de configuración")}</label>
                <input id="setup-code" className="input font-mono tracking-widest" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              {errorBox}
              <button type="submit" className="btn-primary w-full" disabled={pending || !code.trim()}>
                {busy}
                {t("Continuar")}
              </button>
            </form>
          )}

          {step === 2 && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(3); }}>
              <h1 className="text-lg font-semibold">{t("Tu organización")}</h1>
              <div>
                <label className="label" htmlFor="setup-org">{t("Nombre de la organización")}</label>
                <input id="setup-org" className="input" maxLength={80} required autoFocus value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="setup-lang">{t("Idioma de la instalación")}</label>
                <select id="setup-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="setup-tz">{t("Zona horaria")}</label>
                <select id="setup-tz" className="input" value={timeZone} disabled={zoneLocked} onChange={(e) => setTimeZone(e.target.value)}>
                  {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                {zoneLocked && <p className="mt-1 text-xs text-slate-500">{t("Fijada por la variable APP_TIMEZONE del servidor.")}</p>}
              </div>
              {errorBox}
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => go(1)}>{t("Atrás")}</button>
                <button type="submit" className="btn-primary flex-1" disabled={!orgName.trim()}>{t("Continuar")}</button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(4); }}>
              <h1 className="text-lg font-semibold">{t("Primer administrador")}</h1>
              <p className="text-sm text-slate-500">{t("Al entrar por primera vez, Pizarro te pedirá configurar la verificación en dos pasos (obligatoria para administradores).")}</p>
              <div>
                <label className="label" htmlFor="setup-name">{t("Nombre")}</label>
                <input id="setup-name" className="input" maxLength={100} required autoFocus autoComplete="name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="setup-email">Email</label>
                <input id="setup-email" type="email" className="input" maxLength={200} required autoComplete="username" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="setup-password">{t("Contraseña")}</label>
                <PasswordInput id="setup-password" className="input" required minLength={10} autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                <p className="mt-1 text-xs text-slate-500">{t("Mínimo 10 caracteres.")}</p>
              </div>
              {errorBox}
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => go(2)}>{t("Atrás")}</button>
                <button type="submit" className="btn-primary flex-1" disabled={!adminName.trim() || !adminEmail.trim() || adminPassword.length < 10}>{t("Continuar")}</button>
              </div>
            </form>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold">{t("Email")}</h1>
              {smtp ? (
                <>
                  <p className="text-sm text-slate-500">{t("El servidor tiene el envío de emails configurado (SMTP). Puedes comprobarlo ahora con un email de prueba a {email}.", { email: adminEmail })}</p>
                  <button type="button" className="btn-secondary w-full" onClick={sendTest} disabled={pending}>
                    {busy}
                    {t("Enviar email de prueba")}
                  </button>
                </>
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  {t("El envío de emails no está configurado: sin él no hay invitaciones por email ni «¿Olvidaste tu contraseña?». Podrás configurarlo después en Administración → Ajustes.")}{" "}
                  <InfoTip topic={t("Avisos por email")}>{t("También con las variables SMTP_* del servidor (docs/INSTALL.md).")}</InfoTip>
                </p>
              )}
              {infoBox}
              {errorBox}
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => go(3)} disabled={pending}>{t("Atrás")}</button>
                <button type="button" id="setup-finish" className="btn-primary flex-1" onClick={finish} disabled={pending}>
                  {busy}
                  {t("Terminar configuración")}
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-green-600" size={22} />
                <h1 className="text-lg font-semibold">{t("Todo listo")}</h1>
              </div>
              <p className="text-sm text-slate-500">{t("Pizarro está configurado. Entra con tu email y tu contraseña; te pedirá activar la verificación en dos pasos.")}</p>
              {/* Recarga completa: el acceso sale en el idioma recién elegido para la instalación (un Link conservaría el del
                  layout, pintado antes de terminar el asistente). */}
              <a href="/login" className="btn-primary w-full">{t("Ir a iniciar sesión")}</a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
