"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { login, type LoginState } from "@/actions/auth";
import { useT } from "@/i18n/client";

export function LoginForm({ next, canReset }: { next: string; canReset: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  // Controlado: React restablece los formularios tras cada acción y se perdería el email.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">{t("Contraseña")}</label>
        <PasswordInput id="password" name="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{state.error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Loader2 size={16} className="animate-spin" />}
        {t("Entrar")}
      </button>
      {canReset && (
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-brand-700 hover:underline dark:text-brand-300">{t("¿Olvidaste tu contraseña?")}</Link>
        </p>
      )}
    </form>
  );
}
