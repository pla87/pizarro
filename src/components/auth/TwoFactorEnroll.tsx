"use client";

import { Copy, Download, Loader2, Mail, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface BeginData {
  method: "TOTP" | "EMAIL";
  secret?: string;
  uri?: string;
  /** QR de la URI otpauth:// como data: URL (SVG generado en el servidor). */
  qr?: string;
  /** Alta de una app con email disponible: además se ha enviado un código al email que también hay que escribir. */
  emailCodeSent?: boolean;
}

interface Props {
  emailAvailable: boolean;
  /** Empieza el método elegido (el servidor genera el secreto o envía el código por email). */
  begin: (method: "TOTP" | "EMAIL") => Promise<Result<BeginData>>;
  /** Comprueba el primer código y activa el método; devuelve los códigos de recuperación. */
  confirm: (code: string, emailCode?: string) => Promise<Result<{ codes: string[] }>>;
  onCodes: (codes: string[]) => void;
  /** Impide elegir método (por ejemplo, mientras falta la contraseña en «Mi perfil»). */
  disabled?: boolean;
  onCancel?: () => void;
}

/** Secreto en grupos de 4 para copiarlo a mano sin equivocarse. */
const grouped = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/** Pasos comunes de activación: elegir método, enseñar el secreto o pedir el código por email, y confirmar el primer código. */
export function TwoFactorEnroll({ emailAvailable, begin, confirm, onCodes, disabled, onCancel }: Props) {
  const t = useT();
  const [pending, start] = useTransition();
  const [info, setInfo] = useState<BeginData | null>(null);
  const [code, setCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const choose = (method: "TOTP" | "EMAIL") =>
    start(async () => {
      setError(null);
      const res = await begin(method);
      if (!res.ok) return setError(res.error);
      setInfo(res.data);
      setCode("");
      setEmailCode("");
      setSent(method === "EMAIL");
    });

  if (!info) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Elige cómo quieres recibir el segundo código al entrar con contraseña.")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn-secondary justify-start gap-2" disabled={pending || disabled} onClick={() => choose("TOTP")}>
            <Smartphone size={16} /> {t("App de autenticación")}
          </button>
          {emailAvailable && (
            <button type="button" className="btn-secondary justify-start gap-2" disabled={pending || disabled} onClick={() => choose("EMAIL")}>
              <Mail size={16} /> {t("Código por email")}
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t("Cancelar")}</button>}
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await confirm(code, info.emailCodeSent ? emailCode : undefined);
          if (res.ok) onCodes(res.data.codes);
          else setError(res.error);
        });
      }}
    >
      {info.method === "TOTP" ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Añade esta cuenta en tu app de autenticación (Google Authenticator, Aegis, 1Password…) escaneando el código QR o con la clave, y escribe el código de 6 dígitos que te muestre.")}
          </p>
          {info.qr && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL generada en el servidor
            <img src={info.qr} alt={t("Código QR para añadir la cuenta en tu app de autenticación")} width={180} height={180} className="mx-auto h-[180px] w-[180px] rounded-lg bg-white" data-testid="totp-qr" />
          )}
          <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="text-xs text-slate-500">{t("Clave secreta")}</div>
            <code className="block select-all break-all font-mono text-base tracking-wider" data-testid="totp-secret">{grouped(info.secret ?? "")}</code>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <button type="button" className="text-brand-700 hover:underline dark:text-brand-300" onClick={() => void navigator.clipboard?.writeText(info.secret ?? "").catch(() => {})}>
                {t("Copiar clave")}
              </button>
              {info.uri && <a href={info.uri} className="text-brand-700 hover:underline dark:text-brand-300">{t("Abrir en la app")}</a>}
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">{sent ? t("Te hemos enviado un código de 6 dígitos a tu email. Escríbelo aquí.") : t("Pide un código a tu email.")}</p>
          <button type="button" className="btn-ghost shrink-0" disabled={pending} onClick={() => choose("EMAIL")}>{sent ? t("Reenviar") : t("Enviar código")}</button>
        </div>
      )}
      <div>
        <label className="label" htmlFor="enroll-code">{t("Código de verificación")}</label>
        <input id="enroll-code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      {info.emailCodeSent && (
        <div>
          <label className="label" htmlFor="enroll-email-code">{t("Código enviado a tu email")}</label>
          <input id="enroll-email-code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={8} required value={emailCode} onChange={(e) => setEmailCode(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{t("Para confirmar que la cuenta es tuya, escribe también el código que te hemos enviado por email.")}</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || code.replace(/\s/g, "").length !== 6 || (!!info.emailCodeSent && emailCode.replace(/\s/g, "").length !== 6)}>
          {pending && <Loader2 size={16} className="animate-spin" />}
          {t("Activar")}
        </button>
        <button type="button" className="btn-ghost" onClick={() => (setInfo(null), onCancel?.())}>{t("Atrás")}</button>
      </div>
    </form>
  );
}

/** Los 10 códigos de recuperación, que solo se muestran una vez. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Pizarro\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pizarro-codigos-de-recuperacion.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        {t("Guarda estos códigos en un sitio seguro. Cada uno sirve una sola vez si pierdes el acceso a tu app o a tu email, y no volverán a mostrarse.")}
      </p>
      <ul className="mx-auto grid grid-cols-2 justify-items-center gap-1 rounded-lg bg-slate-100 p-3 text-center font-mono text-sm dark:bg-slate-800" data-testid="recovery-codes">
        {codes.map((c) => <li key={c} className="select-all">{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary gap-1.5" onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}><Copy size={14} /> {t("Copiar")}</button>
        <button type="button" className="btn-secondary gap-1.5" onClick={download}><Download size={14} /> {t("Descargar")}</button>
      </div>
    </div>
  );
}
