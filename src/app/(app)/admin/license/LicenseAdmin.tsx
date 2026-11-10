"use client";

import { ExternalLink, Loader2, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeLicense, saveLicense, setPersonalUseDeclared } from "@/actions/license";
import { licenseResolved, personalUseConfirm } from "@/components/LicenseNudge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { LICENSE_EMAIL_MAX, LICENSE_HOLDER_MAX, LICENSE_REF_MAX, type LicenseStatus } from "@/lib/license-core";
import { LICENSE_PRICE_EUR, SITE_URL } from "@/lib/product";
import { actionThrowResult } from "@/lib/stale-action";

/**
 * «Licencia»: estado de la licencia de esta instalación (registrada, declarada de uso personal o educativo o sin registrar) y
 * formulario para registrarla. Todo es informativo (buena voluntad): no bloquea ninguna función ni comprueba nada.
 */
export function LicenseAdmin({ status: initial, buyHref }: { status: LicenseStatus; buyHref: string }) {
  const t = useT();
  const intl = useIntlLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(initial);
  const saved = status.kind === "licensed" ? status.license : null;
  const [holder, setHolder] = useState(saved?.holder ?? "");
  const [reference, setReference] = useState(saved?.reference ?? "");
  const [email, setEmail] = useState(saved?.email ?? "");
  const external = /^https?:\/\//.test(buyHref);
  const dirty = holder.trim() !== (saved?.holder ?? "") || reference.trim() !== (saved?.reference ?? "") || email.trim() !== (saved?.email ?? "");
  const day = (d: string) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : null;
    return date ? date.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" }) : d;
  };
  const done = (message: string) => {
    toast(message, "success");
    router.refresh();
  };

  const save = () =>
    start(async () => {
      const res = await saveLicense({ holder, reference, email }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setStatus({ kind: "licensed", license: res.data });
      licenseResolved();
      done(t("Licencia registrada."));
    });
  const remove = () =>
    start(async () => {
      const res = await removeLicense().catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setStatus({ kind: "none" });
      setHolder("");
      setReference("");
      setEmail("");
      done(t("Registro de licencia quitado."));
    });
  const declarePersonal = async () => {
    if (status.kind === "licensed" && !(await confirm({ ...personalUseConfirm(t), message: t("Se quitará la licencia registrada a nombre de {holder}. Uso personal es el de una persona en su propio servidor, sin fines comerciales ni profesionales; uso educativo, el de un centro de enseñanza y su profesorado y alumnado para dar clase, aprender, investigar u organizar el centro.", { holder: status.license.holder }) }))) return;
    if (status.kind !== "licensed" && !(await confirm(personalUseConfirm(t)))) return;
    start(async () => {
      const res = await setPersonalUseDeclared(true).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      if (res.data) setStatus({ kind: "personal", personal: res.data });
      licenseResolved();
      setHolder("");
      setReference("");
      setEmail("");
      done(t("Anotado: uso personal o educativo. No volverá a salir el recordatorio."));
    });
  };
  const undeclarePersonal = () =>
    start(async () => {
      const res = await setPersonalUseDeclared(false).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setStatus({ kind: "none" });
      done(t("Declaración de uso personal o educativo retirada."));
    });

  return (
    <div className="space-y-4">
      <section className="card space-y-2 p-5" aria-live="polite" data-testid="license-status" data-status={status.kind}>
        <h2 className="text-sm font-semibold">{t("Estado")}</h2>
        {status.kind === "licensed" && (
          <>
            <p className="text-sm font-medium" data-testid="license-registered">{t("Licencia registrada a nombre de {holder}", { holder: status.license.holder })}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {status.license.reference
                ? t("Factura o recibo: {reference} · registrada el {date}", { reference: status.license.reference, date: day(status.license.date) })
                : t("Registrada el {date}", { date: day(status.license.date) })}
            </p>
          </>
        )}
        {status.kind === "personal" && (
          <>
            <p className="text-sm font-medium" data-testid="license-personal">{t("Declarada de uso personal o educativo")}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {status.personal.date ? `${t("Desde el {date}.", { date: day(status.personal.date) })} ` : ""}
              {t("Si empiezas a usar Pizarro en una empresa o para trabajar, registra la licencia más abajo.")}
            </p>
          </>
        )}
        {status.kind === "none" && (
          <>
            <p className="text-sm font-medium" data-testid="license-none">{t("Sin licencia registrada")}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("Si es uso personal o educativo, decláralo y los administradores dejarán de ver el recordatorio. Si es para una empresa o para trabajar, registra la licencia más abajo.")}</p>
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {status.kind !== "personal" && (
            <button type="button" className="btn-secondary" onClick={declarePersonal} disabled={pending} data-testid="license-declare-personal">{t("Uso personal o educativo")}</button>
          )}
          {status.kind === "personal" && (
            <button type="button" className="btn-secondary" onClick={undeclarePersonal} disabled={pending} data-testid="license-undeclare-personal">{t("Quitar la declaración")}</button>
          )}
          {status.kind === "licensed" && (
            <button type="button" className="btn-secondary" onClick={remove} disabled={pending} data-testid="license-remove">{t("Quitar registro")}</button>
          )}
        </div>
        <p className="text-xs text-slate-500">{t("Este registro es solo informativo: Pizarro funciona igual con o sin él, sin comprobaciones ni llamadas a internet.")}</p>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="text-sm font-semibold">{t("Qué uso necesita licencia")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t("Gratis: uso personal y familiar, sin fines comerciales.")}</li>
          <li>{t("Gratis: uso educativo en centros de enseñanza públicos o privados (colegios, institutos, universidades, formación profesional, academias), con su profesorado y alumnado.")}</li>
          <li>{t("Necesita licencia: cualquier otro uso empresarial o profesional (empresa, autónomo, asociación, administración…).")}</li>
          <li>{t("La licencia es un pago único por servidor, con actualizaciones incluidas.")}</li>
        </ul>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t("El texto completo y vinculante es el de la licencia.")}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a href="/licencia" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline dark:text-brand-300" data-testid="license-page-link">
            {t("Leer la licencia")}<ExternalLink size={14} aria-hidden />
          </a>
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline dark:text-brand-300" data-testid="license-site-link">
            getpizarro.com<ExternalLink size={14} aria-hidden />
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
        <h2 className="text-sm font-semibold">{t("Registrar licencia")}</h2>
        <p className="text-sm text-slate-500">{t("Tras comprarla, anota aquí el titular y, si quieres, el número de la factura o del recibo. La fecha se pone sola. Se guarda en esta instalación y queda anotado en el registro de actividad.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{t("Titular (empresa o nombre)")}</span>
            <input className="input mt-1 w-full" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={LICENSE_HOLDER_MAX} placeholder={t("Empresa Ejemplo, S.L.")} autoComplete="off" data-testid="license-holder" />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Nº de factura o recibo (opcional)")}</span>
            <input className="input mt-1 w-full" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={LICENSE_REF_MAX} autoComplete="off" data-testid="license-reference" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium">{t("Email de compra (opcional)")}</span>
            <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={LICENSE_EMAIL_MAX} placeholder={t("compras@example.com")} autoComplete="off" data-testid="license-email" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={pending || !dirty || !holder.trim()} data-testid="license-save">
            {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}{saved ? t("Guardar cambios") : t("Registrar licencia")}
          </button>
        </div>
      </section>
    </div>
  );
}
