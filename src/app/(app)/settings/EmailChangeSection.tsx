"use client";

import { useState, useTransition } from "react";
import { requestEmailChange } from "@/actions/profile";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

/** Cambio de email: se confirma desde un enlace enviado a la dirección nueva. */
export function EmailChangeSection({ email }: { email: string }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <section className="card p-5">
      <h2 className="font-semibold">{t("Cambiar email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {t("Tu email actual es {email}. Enviaremos un enlace de confirmación a la dirección nueva (caduca en 30 minutos) y un aviso a la actual; el cambio solo se hace al confirmarlo.", { email })}
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await requestEmailChange(newEmail, password);
            toast(res.ok ? t("Te hemos enviado un enlace a la dirección nueva para confirmar el cambio.") : res.error, res.ok ? "success" : "error");
            if (res.ok) {
              setNewEmail("");
              setPassword("");
            }
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="em-new">{t("Email nuevo")}</label>
            <input id="em-new" type="email" className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} maxLength={200} required autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="em-pass">{t("Contraseña actual")}</label>
            <PasswordInput id="em-pass" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <button className="btn-primary" disabled={pending}>{t("Enviar confirmación")}</button>
      </form>
    </section>
  );
}
