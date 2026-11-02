"use client";

import { ExternalLink, Loader2, ShoppingCart } from "lucide-react";
import { useState, useTransition } from "react";
import { removeLicense, saveLicense } from "@/actions/license";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { LICENSE_EMAIL_MAX, LICENSE_HOLDER_MAX, LICENSE_REF_MAX, type LicenseRecord } from "@/lib/license-core";
import { LICENSE_PRICE_EUR } from "@/lib/product";
import { actionThrowResult } from "@/lib/stale-action";

/** «Licencia»: estado informativo de la licencia comercial de esta instalación. No bloquea ninguna función. */
export function LicenseAdmin({ license, buyHref }: { license: LicenseRecord | null; buyHref: string }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(license);
  const [holder, setHolder] = useState(license?.holder ?? "");
  const [reference, setReference] = useState(license?.reference ?? "");
  const [email, setEmail] = useState(license?.email ?? "");
  const external = /^https?:\/\//.test(buyHref);
  const dirty = holder.trim() !== (saved?.holder ?? "") || reference.trim() !== (saved?.reference ?? "") || email.trim() !== (saved?.email ?? "");

  const save = () =>
    start(async () => {
      const res = await saveLicense({ holder, reference, email }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setSaved(res.data);
      toast(t("Licencia registrada."), "success");
    });
  const remove = () =>
    start(async () => {
      const res = await removeLicense().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setSaved(null);
      setHolder("");
      setReference("");
      setEmail("");
      toast(t("Registro de licencia quitado."), "success");
    });

  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-5" aria-live="polite" data-testid="license-status">
        <h2 className="text-sm font-semibold">{t("Estado")}</h2>
        {saved ? (
          <p className="text-sm" data-testid="license-registered">
            {t("Licencia comercial registrada: {holder}, {reference}, {date}", { holder: saved.holder, reference: saved.reference, date: saved.date })}
          </p>
        ) : (
          <p className="text-sm" data-testid="license-personal">{t("Uso personal (sin licencia comercial registrada)")}</p>
        )}
        <p className="text-xs text-slate-500">{t("Este registro es solo informativo: Pizarro funciona igual con o sin él, sin comprobaciones ni llamadas a internet.")}</p>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="text-sm font-semibold">{t("Qué uso necesita licencia")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t("Gratis: uso personal y familiar, sin fines comerciales.")}</li>
          <li>{t("Necesita licencia: cualquier uso empresarial o profesional (empresa, autónomo, asociación, centro educativo…).")}</li>
          <li>{t("La licencia es un pago único por servidor, con actualizaciones incluidas.")}</li>
        </ul>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t("El texto completo y vinculante es el de la licencia.")}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a href="/licencia" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline dark:text-brand-300" data-testid="license-page-link">
            {t("Leer la licencia")}<ExternalLink size={14} aria-hidden />
          </a>
          <a
            href={buyHref}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="btn-primary inline-flex items-center gap-2"
            data-testid="license-buy"
          >
            <ShoppingCart size={16} aria-hidden />{t("Comprar licencia ({price} € + IVA)", { price: LICENSE_PRICE_EUR })}
          </a>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t("Registrar la licencia")}</h2>
        <p className="text-sm text-slate-500">{t("Tras comprarla, anota aquí los datos de tu factura. Se guardan en esta instalación y quedan anotados en el registro de actividad.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{t("Titular")}</span>
            <input className="input mt-1 w-full" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={LICENSE_HOLDER_MAX} placeholder={t("Empresa Ejemplo, S.L.")} autoComplete="off" data-testid="license-holder" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Nº de factura o referencia de compra")}</span>
            <input className="input mt-1 w-full" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={LICENSE_REF_MAX} autoComplete="off" data-testid="license-reference" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium">{t("Email de compra (opcional)")}</span>
            <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LICENSE_EMAIL_MAX} placeholder={t("compras@example.com")} autoComplete="off" data-testid="license-email" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={pending || !dirty || !holder.trim() || !reference.trim()} data-testid="license-save">
            {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}{t("Guardar")}
          </button>
          {saved && (
            <button type="button" className="btn-secondary" onClick={remove} disabled={pending} data-testid="license-remove">{t("Quitar registro")}</button>
          )}
        </div>
      </section>
    </div>
  );
}
