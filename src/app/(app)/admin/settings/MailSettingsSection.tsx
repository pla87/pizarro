"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMailSettings, sendMailTest } from "@/actions/mail-settings";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { GMAIL_PRESET, type MailSettings } from "@/lib/mail-settings-core";
import { actionThrowResult } from "@/lib/stale-action";

interface EnvView {
  host: string;
  port: number;
  secure: boolean;
  hasUser: boolean;
  from: string;
}

/** «Envío de emails»: servidor SMTP elegido por un administrador (o, si el servidor define SMTP_*, solo lectura). */
export function MailSettingsSection({ initial, env, outbox }: { initial: MailSettings; env: EnvView | null; outbox: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState({ host: initial.host, port: String(initial.port), secure: initial.secure, user: initial.user, fromName: initial.fromName, fromAddress: initial.fromAddress });
  const [password, setPassword] = useState("");
  const [replacing, setReplacing] = useState(!initial.hasPassword);
  const [clearPassword, setClearPassword] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const dirty =
    form.host !== saved.host || Number(form.port) !== saved.port || form.secure !== saved.secure || form.user !== saved.user ||
    form.fromName !== saved.fromName || form.fromAddress !== saved.fromAddress || password !== "" || clearPassword;

  const body = () => ({ host: form.host, port: Number(form.port), secure: form.secure, user: form.user, fromName: form.fromName, fromAddress: form.fromAddress });

  const save = () =>
    start(async () => {
      const res = await saveMailSettings({ ...body(), password, clearPassword }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      const s = res.data.settings;
      setSaved(s);
      setForm({ host: s.host, port: String(s.port), secure: s.secure, user: s.user, fromName: s.fromName, fromAddress: s.fromAddress });
      setPassword("");
      setClearPassword(false);
      setReplacing(!s.hasPassword);
      setTestError(null);
      toast(s.host ? t("Configuración de email guardada.") : t("Envío de emails desactivado."), "success");
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

  const useGmail = () => {
    setForm((f) => ({ ...f, host: GMAIL_PRESET.host, port: String(GMAIL_PRESET.port), secure: GMAIL_PRESET.secure }));
  };

  // Al cambiar el tipo de conexión se ajusta el puerto habitual si aún tiene el del otro.
  const setSecure = (secure: boolean) =>
    setForm((f) => ({ ...f, secure, port: secure && f.port === "587" ? "465" : !secure && f.port === "465" ? "587" : f.port }));

  const connection = (secure: boolean) => (secure ? t("SSL/TLS (puerto 465)") : t("STARTTLS (puerto 587)"));

  if (env) {
    return (
      <section className="card space-y-3 p-5">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Mail size={15} /> {t("Envío de emails")}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{t("Configurado en el servidor (variables SMTP_*). Para cambiarlo hay que editar las variables del servicio; aquí solo se muestra.")}</p>
        </div>
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

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Mail size={15} /> {t("Envío de emails")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {t("Para enviar enlaces de acceso, avisos e informes por email. Déjalo vacío para desactivar el envío. La contraseña se guarda cifrada y no se vuelve a mostrar.")}
        </p>
        {outbox && <p className="mt-1 text-xs text-amber-600">{t("El buzón de pruebas (MAIL_OUTBOX_DIR) está activo: los emails se guardan en disco en vez de enviarse.")}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary py-1.5" onClick={useGmail}>{t("Usar Gmail")}</button>
        <span className="text-xs text-slate-500">{t("Rellena smtp.gmail.com, puerto 465 y SSL/TLS.")}</span>
      </div>
      <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
        {t("Gmail no acepta tu contraseña normal: necesita una contraseña de aplicación. Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones. El usuario es tu dirección de Gmail y la contraseña, la de 16 letras que genera Google.")}
      </p>
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
        <div className="block text-sm">
          <label htmlFor="mail-pass" className="font-medium">{t("Contraseña")}</label>
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
        <label className="block text-sm">
          <span className="font-medium">{t("Nombre del remitente")}</span>
          <input className="input mt-1 w-full" value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Pizarro" maxLength={100} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("Email del remitente")}</span>
          <input className="input mt-1 w-full" type="email" value={form.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder="pizarro@example.com" maxLength={200} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary py-1.5" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
        </button>
        {dirty && saved.host !== "" && <span className="text-xs text-slate-500">{t("Guarda los cambios antes de enviar la prueba.")}</span>}
      </div>
      <TestRow testing={testing} onTest={test} error={testError} disabled={dirty || (!saved.host && !outbox)} t={t} />
    </section>
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
