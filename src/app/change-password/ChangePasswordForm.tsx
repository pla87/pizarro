"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logout, setNewPassword } from "@/actions/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useT } from "@/i18n/client";

export function ChangePasswordForm({ email }: { email: string }) {
  const t = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (password !== repeat) return setError(t("Las contraseñas nuevas no coinciden."));
        start(async () => {
          const res = await setNewPassword(password);
          if (!res.ok) return setError(res.error);
          router.replace("/");
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-slate-500">{t("Por seguridad, antes de seguir tienes que elegir una contraseña nueva, distinta de la actual.")}</p>
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label className="label" htmlFor="cp-new">{t("Nueva contraseña (mín. 10)")}</label>
        <PasswordInput id="cp-new" className="input" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="cp-repeat">{t("Repite la nueva")}</label>
        <PasswordInput id="cp-repeat" className="input" autoComplete="new-password" minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Loader2 size={16} className="animate-spin" />}
        {t("Guardar contraseña")}
      </button>
      <button type="button" className="btn-secondary w-full" disabled={pending} onClick={() => start(() => logout())}>{t("Cerrar sesión")}</button>
    </form>
  );
}
