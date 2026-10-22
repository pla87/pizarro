"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmAccountChange } from "@/actions/auth";
import { useT } from "@/i18n/client";

export function ConfirmForm({ token, kind, newEmail }: { token: string; kind: "EMAIL" | "PASSWORD"; newEmail: string | null }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="space-y-4 text-sm">
        <p>{kind === "EMAIL" ? t("Email actualizado. Úsalo la próxima vez que inicies sesión.") : t("Contraseña actualizada. Se han cerrado todas las sesiones: inicia sesión con la nueva.")}</p>
        <Link href={kind === "EMAIL" ? "/settings" : "/login"} className="btn-primary w-full">{kind === "EMAIL" ? t("Ir a mi perfil") : t("Iniciar sesión")}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p>
        {kind === "EMAIL"
          ? t("El email de tu cuenta de Pizarro pasará a ser {email}.", { email: newEmail ?? "" })
          : t("Se aplicará la contraseña nueva que elegiste en tu perfil y se cerrarán todas las sesiones abiertas.")}
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <button
        className="btn-primary w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await confirmAccountChange(token);
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {t("Confirmar")}
      </button>
    </div>
  );
}
