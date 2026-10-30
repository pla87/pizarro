"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { login, type LoginState } from "@/actions/auth";
import { useT } from "@/i18n/client";

interface Props {
  next: string;
  /** Botón «Iniciar sesión con Google». */
  google: boolean;
  /** Formulario de email y contraseña. */
  password: boolean;
  /** Solo Google: el formulario es el acceso de emergencia de los administradores y va plegado. */
  emergency: boolean;
  notice: string | null;
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function LoginForm({ next, google, password, emergency, notice }: Props) {
  const t = useT();
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  // Controlado: React restablece los formularios tras cada acción y se perdería el email.
  const [email, setEmail] = useState("");
  const form = (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" autoFocus={!emergency} value={email} onChange={(e) => setEmail(e.target.value)} />
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
      {/* Siempre visible: sin email configurado, /forgot-password explica las alternativas. */}
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline dark:text-brand-300">{t("¿Olvidaste tu contraseña?")}</Link>
      </p>
    </form>
  );
  const googleHref = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className="space-y-4">
      {notice && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{notice}</p>}
      {google && (
        // Enlace normal (no fetch): es una redirección completa a Google y de vuelta.
        <a href={googleHref} className="btn-secondary flex w-full items-center justify-center gap-2">
          <GoogleLogo />
          {t("Iniciar sesión con Google")}
        </a>
      )}
      {google && password && !emergency && <p className="text-center text-xs text-slate-500">{t("o con tu email")}</p>}
      {password && emergency && (
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" open={Boolean(state.error)}>
          <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-300">{t("Acceso de emergencia (administradores)")}</summary>
          <div className="mt-3">{form}</div>
        </details>
      )}
      {password && !emergency && form}
    </div>
  );
}
