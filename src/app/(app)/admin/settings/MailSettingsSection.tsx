"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMailSettings, sendMailTest } from "@/actions/mail-settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { detectMailPreset, GMAIL_PRESET, MAIL_PRESETS, type MailMode, type MailSettings } from "@/lib/mail-settings-core";
import { actionThrowResult } from "@/lib/stale-action";

interface EnvView {
  host: string;
  port: number;
  secure: boolean;
  hasUser: boolean;
  from: string;
}

/** «Avisos por email»: cómo envía Pizarro los avisos y los emails de las cuentas (o, si el servidor define SMTP_*, solo lectura). */
export function MailSettingsSection({ initial, env, outbox }: { initial: MailSettings; env: EnvView | null; outbox: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [saved, setSaved] = useState(initial);
  const toForm = (s: MailSettings) => ({ host: s.host, port: String(s.port), secure: s.secure, user: s.user, fromName: s.fromName, fromAddress: s.fromAddress });
  const [mode, setMode] = useState<MailMode>(initial.mode);
  const [form, setForm] = useState(toForm(initial));
  const [password, setPassword] = useState("");
  const [replacing, setReplacing] = useState(!initial.hasPassword);
  const [clearPassword, setClearPassword] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // En la opción de Gmail el servidor es siempre el de Gmail y la dirección es a la vez usuario y remitente.
  const gmail = mode === "gmail";
  const effective = gmail
    ? { host: GMAIL_PRESET.host, port: GMAIL_PRESET.port, secure: GMAIL_PRESET.secure, user: form.user, fromName: form.fromName, fromAddress: form.user.trim() }
    : { host: form.host, port: Number(form.port), secure: form.secure, user: form.user, fromName: form.fromName, fromAddress: form.fromAddress };

  const dirty =
    mode !== saved.mode || effective.host !== saved.host || effective.port !== saved.port || effective.secure !== saved.secure || effective.user !== saved.user ||
    effective.fromName !== saved.fromName || effective.fromAddress !== saved.fromAddress || password !== "" || clearPassword;

  const apply = (s: MailSettings) => {
    setSaved(s);
    setMode(s.mode);
    setForm(toForm(s));
    setPassword("");
    setClearPassword(false);
    setReplacing(!s.hasPassword);
    setTestError(null);
  };

  const save = (disable = false) =>
    start(async () => {
      const payload = disable ? { host: "", port: 465, secure: true, user: "", fromName: "", fromAddress: "" } : effective;
      const res = await saveMailSettings({ ...payload, mode, password: disable ? "" : password, clearPassword: disable ? true : clearPassword }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      apply(res.data.settings);
      toast(res.data.settings.host ? t("Configuración de email guardada.") : t("Envío de emails desactivado."), "success");
      router.refresh();
    });

  const test = () =>
    startTest(async () => {
      setTestError(null);
      const res = await sendMailTest().catch((e) => actionThrowResult(e, t));
      if (!res.ok) {
        setTestError(res.error);
        return;
      }
      toast(t("Email de prueba enviado a {to}.", { to: res.data.to }), "success");
    });

  const chooseMode = (m: MailMode) => {
    if (m === mode) return;
    setMode(m);
    // Al pasar a «empresa» no se arrastra el servidor de Gmail: se deja elegir el proveedor.
    if (m === "company" && form.host === GMAIL_PRESET.host) setForm((f) => ({ ...f, host: "", fromAddress: "" }));
  };

  const preset = detectMailPreset(form.host, Number(form.port));
  const choosePreset = (id: string) => {
    const p = MAIL_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => ({ ...f, host: p.host, port: String(p.port), secure: p.secure, user: p.user ?? (f.user === "apikey" ? "" : f.user) }));
  };

  // Al cambiar el tipo de conexión se ajusta el puerto habitual si aún tiene el del otro.
  const setSecure = (secure: boolean) =>
    setForm((f) => ({ ...f, secure, port: secure && f.port === "587" ? "465" : !secure && f.port === "465" ? "587" : f.port }));

  const connection = (secure: boolean) => (secure ? t("SSL/TLS (puerto 465)") : t("STARTTLS (puerto 587)"));

  const header = (
    <div>
      <h2 className="flex items-center gap-1.5 text-base font-semibold"><Mail size={16} /> {t("1. Avisos por email")}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{t("Cómo envía Pizarro los avisos, los enlaces de acceso y los informes por email. No tiene que ver con «Acceso con Google», que va aparte más abajo.")}</p>
    </div>
  );

  if (env) {
    return (
      <section id="avisos-email" className="card space-y-3 p-5">
        {header}
        <p className="text-xs text-slate-500">{t("Configurado en el servidor (variables SMTP_*). Para cambiarlo hay que editar las variables del servicio; aquí solo se muestra.")}</p>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">{t("Servidor SMTP")}</dt><dd>{env.host}</dd>
          <dt className="text-slate-500">{t("Puerto")}</dt><dd>{env.port} · {connection(env.secure)}</dd>
          <dt className="text-slate-500">{t("Usuario")}</dt><dd>{env.hasUser ? t("configurado en el servidor") : t("sin autenticación")}</dd>
          <dt className="text-slate-500">{t("Remitente")}</dt><dd>{env.from}</dd>
        </dl>
        <TestRow testing={testing} onTest={test} error={testError} t={t} />
      </section>
    );
  }

  const passwordField = (
    <div className="block text-sm">
      <label htmlFor="mail-pass" className="font-medium">{gmail ? t("Contraseña de aplicación") : t("Contraseña")}</label>
      {saved.hasPassword && !replacing && !clearPassword ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{t("guardada")}</span>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setReplacing(true)}>{t("Reemplazar")}</button>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setClearPassword(true)}>{t("Quitar")}</button>
        </div>
      ) : clearPassword ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{t("Se quitará al guardar.")}</span>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setClearPassword(false)}>{t("Cancelar")}</button>
        </div>
      ) : (
        <input id="mail-pass" className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={500} placeholder={saved.hasPassword ? t("Contraseña nueva") : ""} />
      )}
    </div>
  );

  const nameField = (
    <label className="block text-sm">
      <span className="font-medium">{t("Nombre del remitente")}</span>
      <input className="input mt-1 w-full" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Pizarro" maxLength={100} />
    </label>
  );

  return (
    <section id="avisos-email" className="card space-y-4 p-5">
      {header}
      {outbox && <p className="text-xs text-amber-600">{t("El buzón de pruebas (MAIL_OUTBOX_DIR) está activo: los emails se guardan en disco en vez de enviarse.")}</p>}
      <p className="text-xs text-slate-500">{t("Elige una opción. La contraseña se guarda cifrada y no se vuelve a mostrar.")}</p>

      <div role="radiogroup" aria-label={t("Cómo se envían los emails")} className="grid gap-3 sm:grid-cols-2">
        <ModeCard checked={gmail} onSelect={() => chooseMode("gmail")} title={t("Gmail de un administrador (uso familiar)")}
          text={t("Sencillo y gratuito: los emails salen de una cuenta de Gmail o de Google. Vale para equipos pequeños; Google limita los envíos diarios.")} />
        <ModeCard checked={!gmail} onSelect={() => chooseMode("company")} title={t("Servicio de correo de la empresa")}
          text={t("Un servidor SMTP profesional: Google Workspace, Brevo, SendGrid, Amazon SES, Mailgun, Microsoft 365… Para más envíos y mejor entrega.")} />
      </div>

      {gmail ? (
        <div className="space-y-3">
          <details className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300" open={!saved.hasPassword}>
            <summary className="cursor-pointer font-medium">{t("Cómo conseguir la contraseña de aplicación de Gmail")}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{t("Entra en tu cuenta de Google → Seguridad y activa la «Verificación en dos pasos» (si no la tienes).")}</li>
              <li>{t("Abre myaccount.google.com/apppasswords, escribe un nombre (por ejemplo «Pizarro») y pulsa Crear.")}</li>
              <li>{t("Google te muestra una contraseña de 16 letras. Cópiala y pégala aquí abajo (con o sin espacios).")}</li>
              <li>{t("Gmail no acepta tu contraseña normal, solo esta. Si no ves la opción, tu cuenta (por ejemplo la de un colegio o una empresa) puede tenerla bloqueada.")}</li>
            </ol>
            <p className="mt-2"><a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a> · {t("Se usará smtp.gmail.com, puerto 465 con SSL/TLS.")}</p>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">{t("Dirección de Gmail")}</span>
              <input className="input mt-1 w-full" type="email" value={form.user} onChange={(e) => set("user", e.target.value)} placeholder="nombre@gmail.com" autoComplete="off" maxLength={200} />
            </label>
            {passwordField}
            {nameField}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm sm:max-w-md">
            <span className="font-medium">{t("Proveedor")}</span>
            <select className="input mt-1 w-full" value={preset?.id ?? "other"} onChange={(e) => e.target.value !== "other" && choosePreset(e.target.value)}>
              <option value="other">{preset ? t("Otro (rellenar a mano)") : t("Elige un proveedor o rellena a mano")}</option>
              {MAIL_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
            </select>
          </label>
          {preset && <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">{t(preset.hint)}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">{t("Servidor SMTP")}</span>
              <input className="input mt-1 w-full" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" autoComplete="off" maxLength={255} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="font-medium">{t("Puerto")}</span>
                <input className="input mt-1 w-full" type="number" inputMode="numeric" min={1} max={65535} value={form.port} onChange={(e) => set("port", e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">{t("Conexión")}</span>
                <select className="input mt-1 w-full" value={form.secure ? "ssl" : "starttls"} onChange={(e) => setSecure(e.target.value === "ssl")}>
                  <option value="ssl">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-medium">{t("Usuario")}</span>
              <input className="input mt-1 w-full" value={form.user} onChange={(e) => set("user", e.target.value)} autoComplete="off" maxLength={200} />
            </label>
            {passwordField}
            {nameField}
            <label className="block text-sm">
              <span className="font-medium">{t("Email del remitente")}</span>
              <input className="input mt-1 w-full" type="email" value={form.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder="pizarro@example.com" maxLength={200} />
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={() => save()} disabled={pending || !dirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        {saved.host !== "" && (
          <button className="btn-secondary py-1.5" onClick={() => save(true)} disabled={pending}>{t("Desactivar el envío de emails")}</button>
        )}
        {dirty && saved.host !== "" && <span className="text-xs text-slate-500">{t("Guarda los cambios antes de enviar la prueba.")}</span>}
      </div>
      <TestRow testing={testing} onTest={test} error={testError} disabled={dirty || (!saved.host && !outbox)} t={t} />
    </section>
  );
}

function ModeCard({ checked, onSelect, title, text }: { checked: boolean; onSelect: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition-colors ${checked ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-950/30" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs text-slate-500">{text}</span>
    </button>
  );
}

function TestRow({ testing, onTest, error, disabled, t }: { testing: boolean; onTest: () => void; error: string | null; disabled?: boolean; t: ReturnType<typeof useT> }) {
  return (
    <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary py-1.5" onClick={onTest} disabled={testing || disabled}>
          {testing && <Loader2 size={15} className="animate-spin" />} {t("Enviar email de prueba")}
        </button>
        <span className="text-xs text-slate-500">{t("Se envía a tu propio email con la configuración guardada.")}</span>
      </div>
      {error && <p role="alert" className="break-words rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    </div>
  );
}
