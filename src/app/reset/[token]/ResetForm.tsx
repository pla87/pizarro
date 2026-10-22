"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { resetPassword } from "@/actions/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useT } from "@/i18n/client";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="space-y-4 text-sm">
        <p>{t("Contraseña guardada. Por seguridad se han cerrado todas las sesiones: inicia sesión con la nueva.")}</p>
        <Link href="/login" className="btn-primary w-full">{t("Iniciar sesión")}</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (password !== repeat) return setError(t("Las contraseñas nuevas no coinciden."));
        start(async () => {
          const res = await resetPassword(token, password);
          if (res.ok) setDone(true);
          else setError(res.error);
        });
      }}
    >
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label className="label" htmlFor="rs-new">{t("Nueva contraseña (mín. 10)")}</label>
        <PasswordInput id="rs-new" className="input" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="rs-repeat">{t("Repite la nueva")}</label>
        <PasswordInput id="rs-repeat" className="input" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Loader2 size={16} className="animate-spin" />}
        {t("Guardar contraseña")}
      </button>
    </form>
  );
}
