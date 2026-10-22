"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { beginEnrollment, confirmEnrollment, disableTwoFactor, regenerateRecoveryCodes } from "@/actions/two-factor";
import { RecoveryCodes, TwoFactorEnroll } from "@/components/auth/TwoFactorEnroll";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

interface Props {
  method: "TOTP" | "EMAIL" | null;
  admin: boolean;
  emailAvailable: boolean;
  codesLeft: number;
}

type Mode = "enroll" | "regen" | "disable";

/** «Verificación en dos pasos» del acceso con contraseña (el acceso con Google no la usa: Google tiene la suya). */
export function TwoFactorSection({ method, admin, emailAvailable, codesLeft }: Props) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  const reset = () => {
    setMode(null);
    setPassword("");
    setCodes(null);
    router.refresh();
  };

  return (
    <section className="card p-5" id="two-factor">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} /> {t("Verificación en dos pasos")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {admin
          ? t("Obligatoria para administradores al entrar con contraseña. Al entrar con Google no se pide: Google ya tiene la suya.")
          : t("Añade un segundo código al entrar con contraseña. Al entrar con Google no se pide: Google ya tiene la suya.")}
      </p>

      {codes ? (
        <div className="mt-4 space-y-3">
          <RecoveryCodes codes={codes} />
          <button className="btn-primary" onClick={reset}>{t("He guardado los códigos")}</button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            {method
              ? <><span className="badge bg-emerald-50 text-emerald-700 ring-emerald-500/20">{t("Activada")}</span>{" "}
                  {method === "TOTP" ? t("App de autenticación") : t("Código por email")} · {t("{n} códigos de recuperación sin usar", { n: codesLeft })}</>
              : <span className="badge bg-slate-100 text-slate-600 ring-slate-500/20">{t("Desactivada")}</span>}
          </p>

          {mode === null && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => setMode("enroll")}>{method ? t("Cambiar de método") : t("Activar")}</button>
              {method && <button className="btn-secondary" onClick={() => setMode("regen")}>{t("Generar códigos de recuperación nuevos")}</button>}
              {method && !admin && <button className="btn-secondary" onClick={() => setMode("disable")}>{t("Desactivar")}</button>}
            </div>
          )}

          {mode && (
            <div className="space-y-3">
              <div className="max-w-sm">
                <label className="label" htmlFor="tf-pass">{t("Contraseña actual")}</label>
                <PasswordInput id="tf-pass" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {mode === "enroll" && (
                <TwoFactorEnroll
                  emailAvailable={emailAvailable}
                  disabled={!password}
                  begin={(m) => beginEnrollment(m, password)}
                  confirm={(c) => confirmEnrollment(c)}
                  onCodes={setCodes}
                  onCancel={() => setMode(null)}
                />
              )}
              {mode !== "enroll" && (
                <div className="flex gap-2">
                  <button
                    className={mode === "disable" ? "btn-danger" : "btn-primary"}
                    disabled={pending || !password}
                    onClick={() => start(async () => {
                      if (mode === "disable") {
                        const res = await disableTwoFactor(password);
                        if (!res.ok) return void toast(res.error, "error");
                        toast(t("Verificación en dos pasos desactivada."), "success");
                        reset();
                      } else {
                        const res = await regenerateRecoveryCodes(password);
                        if (!res.ok) return void toast(res.error, "error");
                        setCodes(res.data.codes);
                      }
                    })}
                  >
                    {mode === "disable" ? t("Desactivar") : t("Generar")}
                  </button>
                  <button className="btn-ghost" onClick={() => setMode(null)}>{t("Cancelar")}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
