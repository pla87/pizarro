"use client";

import { useState } from "react";
import { cancelSecondStep, chooseSetupMethod, confirmSetup, finishSetup } from "@/actions/two-factor";
import { RecoveryCodes, TwoFactorEnroll } from "@/components/auth/TwoFactorEnroll";
import { useT } from "@/i18n/client";

/** Administrador sin segundo paso: debe configurarlo antes de entrar. La sesión solo se abre en finishSetup. */
export function SetupForm({ emailAvailable, confirmed }: { emailAvailable: boolean; confirmed: boolean }) {
  const t = useT();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  if (codes || confirmed) {
    return (
      <form action={finishSetup} className="space-y-4">
        {codes ? <RecoveryCodes codes={codes} /> : <p className="text-sm text-slate-600 dark:text-slate-300">{t("La verificación ya está activada. Puedes generar códigos de recuperación nuevos en «Mi perfil».")}</p>}
        {codes && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            {t("He guardado los códigos")}
          </label>
        )}
        <button className="btn-primary w-full" disabled={Boolean(codes) && !saved}>{t("Entrar")}</button>
      </form>
    );
  }
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        {t("Los administradores deben activar la verificación en dos pasos antes de entrar con contraseña.")}
      </p>
      <TwoFactorEnroll emailAvailable={emailAvailable} begin={(m) => chooseSetupMethod(m)} confirm={(c, e) => confirmSetup(c, e)} onCodes={setCodes} />
      <form action={cancelSecondStep}>
        <button className="text-sm text-slate-500 hover:underline">{t("Volver")}</button>
      </form>
    </div>
  );
}
