"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { resendLoginCode, verifyLoginCode, type VerifyState } from "@/actions/two-factor";
import { reloadForNewVersion } from "@/components/VersionWatcher";
import { useLocale, useT } from "@/i18n/client";
import { installSectionUrl } from "@/lib/product";
import { AUTH_TEXT_LINK } from "@/components/auth/AuthCard";
import { BackToLogin } from "./BackToLogin";
import { guardFormAction } from "@/lib/guard-action";
import { useActionTransition } from "@/components/useActionTransition";

/** emailStatus: «sent», el código ha salido; «capped», no ha salido por el tope de envíos de la persona. */
export function VerifyForm({ method, emailStatus }: { method: "TOTP" | "EMAIL"; emailStatus: "sent" | "capped" | null }) {
  const t = useT();
  const locale = useLocale();
  // guardFormAction: tras un despliegue esta página puede ser de la versión anterior; entonces se recarga en vez de romper.
  const guarded = useMemo(() => guardFormAction(verifyLoginCode, t, reloadForNewVersion), [t]);
  const [state, action, pending] = useActionState<VerifyState, FormData>(guarded, {});
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(
    emailStatus === "sent" ? { ok: true, text: t("Te hemos enviado un código a tu email.") }
      : emailStatus === "capped" ? { ok: false, text: t("Demasiados envíos. Espera unos minutos.") }
        : null,
  );
  const [resending, startResend] = useActionTransition((text) => setNote({ ok: false, text }));

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {/* text-pretty: sin una palabra sola en la última línea (con el borde derecho irregular, la caja parecía descentrada). */}
        <p className="text-sm text-pretty text-slate-600 dark:text-slate-300">
          {method === "EMAIL" && emailStatus === "capped"
            ? t("Escribe un código de recuperación o, pasados unos minutos, pulsa «Reenviar código» y escribe el de 6 dígitos del email.")
            : method === "EMAIL"
            ? t("Escribe el código de 6 dígitos que te hemos enviado por email, o un código de recuperación.")
            : t("Escribe el código de 6 dígitos de tu app de autenticación, o un código de recuperación.")}
        </p>
        <div>
          <label className="label" htmlFor="code">{t("Código de verificación")}</label>
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
      {/* Centrados y subrayados, como «Volver a iniciar sesión» de Recuperar contraseña (antes «Volver» iba a la derecha). */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {method === "EMAIL" && (
          <button
            type="button"
            className={AUTH_TEXT_LINK}
            disabled={resending}
            onClick={() => startResend(async () => {
              const res = await resendLoginCode();
              setNote(res.ok ? { ok: true, text: t("Código reenviado.") } : { ok: false, text: res.error });
            })}
          >
            {t("Reenviar código")}
          </button>
        )}
        <BackToLogin />
      </div>
      {/* Sin el móvil, la app o el email no hay forma de pasar de aquí: a quién pedírselo y, si no hay nadie, la guía. Una
          nota al pie, centrada y con las líneas equilibradas (alineada a la izquierda, sus saltos descentraban la caja). */}
      <p className="border-t border-slate-200 pt-4 text-center text-xs text-balance text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {t("¿Sin acceso a tus códigos? Pide a un administrador que restablezca tu verificación en dos pasos; si eres el único administrador, sigue la guía")}{" "}
        <a href={installSectionUrl("lockedOut", locale)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">
          {t("«Nadie puede entrar como administrador»")}
        </a>
        .
      </p>
    </div>
  );
}
