"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useMemo, useState, useTransition } from "react";
import { cancelSecondStep, resendLoginCode, verifyLoginCode, type VerifyState } from "@/actions/two-factor";
import { reloadForNewVersion } from "@/components/VersionWatcher";
import { useT } from "@/i18n/client";
import { guardFormAction } from "@/lib/guard-action";

export function VerifyForm({ method, emailSent }: { method: "TOTP" | "EMAIL"; emailSent: boolean }) {
  const t = useT();
  // guardFormAction: tras un despliegue esta página puede ser de la versión anterior; entonces se recarga en vez de romper.
  const guarded = useMemo(() => guardFormAction(verifyLoginCode, t, reloadForNewVersion), [t]);
  const [state, action, pending] = useActionState<VerifyState, FormData>(guarded, {});
  const [resending, startResend] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(emailSent ? { ok: true, text: t("Te hemos enviado un código a tu email.") } : null);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {method === "EMAIL"
            ? t("Escribe el código de 6 dígitos que te hemos enviado por email, o un código de recuperación.")
            : t("Escribe el código de 6 dígitos de tu app de autenticación, o un código de recuperación.")}
        </p>
        <div>
          <label className="label" htmlFor="code">{t("Código")}</label>
          <input id="code" name="code" className="input" autoComplete="one-time-code" autoFocus required maxLength={24} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remember" className="size-4 rounded" />
          {t("Recordar este dispositivo 14 días")}
        </label>
        {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{state.error}</p>}
        {note && <p role="status" className={note.ok ? "text-sm text-slate-500" : "text-sm text-red-600 dark:text-red-400"}>{note.text}</p>}
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending && <Loader2 size={16} className="animate-spin" />}
          {t("Verificar")}
        </button>
      </form>
      <div className="flex items-center justify-between text-sm">
        {method === "EMAIL" ? (
          <button
            type="button"
            className="text-brand-700 hover:underline dark:text-brand-300"
            disabled={resending}
            onClick={() => startResend(async () => {
              const res = await resendLoginCode();
              setNote(res.ok ? { ok: true, text: t("Código reenviado.") } : { ok: false, text: res.error });
            })}
          >
            {t("Reenviar código")}
          </button>
        ) : <span />}
        <form action={cancelSecondStep}>
          <button className="text-slate-500 hover:underline">{t("Volver")}</button>
        </form>
      </div>
    </div>
  );
}
