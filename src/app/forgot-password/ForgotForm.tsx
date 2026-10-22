"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/actions/auth";
import { useT } from "@/i18n/client";

export function ForgotForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div className="space-y-4 text-sm">
        <p>{t("Si existe una cuenta con ese email, te hemos enviado un enlace para elegir una contraseña nueva. Caduca en 30 minutos.")}</p>
        <Link href="/login" className="btn-secondary w-full">{t("Volver a iniciar sesión")}</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await requestPasswordReset(email);
          if (res.ok) setSent(true);
          else setError(res.error);
        });
      }}
    >
      <p className="text-sm text-slate-500">{t("Escribe el email de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.")}</p>
      <div>
        <label className="label" htmlFor="fp-email">Email</label>
        <input id="fp-email" type="email" autoComplete="username" required className="input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Loader2 size={16} className="animate-spin" />}
        {t("Enviar enlace")}
      </button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-brand-700 hover:underline dark:text-brand-300">{t("Volver a iniciar sesión")}</Link>
      </p>
    </form>
  );
}
