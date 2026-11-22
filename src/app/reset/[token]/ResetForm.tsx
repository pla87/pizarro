"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { resetPassword } from "@/actions/auth";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";

/**
 * `invite`: el enlace es una invitación (cuenta nueva, sin sesiones que cerrar), no un «olvidé mi contraseña».
 * `next`: adónde lleva el acceso al terminar (el tablero del proyecto de una invitación).
 * `googleOnly`: con «solo Google» (AUTH_GOOGLE_ONLY) esta persona no entra con contraseña: al terminar se le dice que
 * entre con Google (antes se le decía que entrara con la contraseña y solo veía «Credenciales incorrectas»).
 */
export function ResetForm({ token, email, invite = false, next, googleOnly = false }: { token: string; email: string; invite?: boolean; next?: string; googleOnly?: boolean }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useActionTransition(setError);

  if (done) {
    return (
      <div className="space-y-4 text-sm">
        <p>
          {googleOnly
            ? invite
              ? t("Contraseña guardada. En este servidor se entra con Google: pulsa «Iniciar sesión con Google» con {email}.", { email })
              : t("Contraseña guardada. Por seguridad se han cerrado todas las sesiones. En este servidor se entra con Google: pulsa «Iniciar sesión con Google» con {email}.", { email })
            : invite
              ? t("Contraseña guardada. Ya puedes iniciar sesión con tu email y la contraseña que acabas de elegir.")
              : t("Contraseña guardada. Por seguridad se han cerrado todas las sesiones: inicia sesión con la nueva.")}
        </p>
        {/* Recarga completa (no Link): el layout raíz conserva el idioma de esta página (el del enlace) en la navegación de
            cliente, y el acceso sale en el de la instalación: con Link la pantalla quedaba en dos idiomas. */}
        <a href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="btn-primary w-full">{t("Iniciar sesión")}</a>
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
