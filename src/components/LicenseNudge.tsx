"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setPersonalUseDeclared, snoozeLicenseNudge } from "@/actions/license";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/shared";
import { LICENSE_PRICE_EUR } from "@/lib/product";
import { actionThrowResult } from "@/lib/stale-action";
import { useConfirm } from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";

const SEEN_AFTER_MS = 3000;

/** Texto de la confirmación «Es uso personal» (también la usa Administración → Licencia). */
export function personalUseConfirm(t: T) {
  return {
    title: t("¿Es uso personal?"),
    message: (
      <div className="space-y-2">
        <p>{t("Uso personal es el de una persona en su propio servidor, para fines personales, domésticos o familiares, sin fines comerciales ni profesionales.")}</p>
        <p>{t("Si usas Pizarro en una empresa, como autónomo o en cualquier organización (también asociaciones y centros educativos), necesitas una licencia.")}</p>
        <p>{t("El recordatorio dejará de salir para todos los administradores. Puedes cambiarlo en Administración → Licencia.")}</p>
      </div>
    ),
    confirmLabel: t("Sí, es uso personal"),
  };
}

/**
 * Recordatorio de licencia «tipo WinRAR» para administradores: una franja fina bajo la cabecera, no modal, que sale
 * como mucho una vez cada 30 días por administrador (al mostrarse queda pospuesto). Nunca bloquea nada. En móvil se
 * oculta mientras hay un diálogo abierto (editar o crear una tarea), y no sale en la propia pestaña Licencia.
 */
export function LicenseNudge({ buyHref }: { buyHref: string }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const marked = useRef(false);
  const onLicensePage = pathname.startsWith("/admin/license");

  // Verlo cuenta como el aviso del mes: tras unos segundos en pantalla se pospone 30 días (aunque no se pulse nada).
  // La espera evita gastarlo en una carga que redirige al momento (p. ej. «/» → último tablero).
  useEffect(() => {
    if (!open || onLicensePage || marked.current) return;
    const timer = setTimeout(() => {
      marked.current = true;
      snoozeLicenseNudge().catch(() => {});
    }, SEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, onLicensePage]);

  if (!open || onLicensePage) return null;
  const external = /^https?:\/\//.test(buyHref);
  const btn = "rounded px-2 py-0.5 font-medium hover:bg-brand-100 disabled:opacity-60 dark:hover:bg-brand-500/20";

  const later = () => {
    setOpen(false);
    if (!marked.current) {
      marked.current = true;
      snoozeLicenseNudge().catch(() => {});
    }
  };

  const personal = async () => {
    if (!(await confirm(personalUseConfirm(t)))) return;
    start(async () => {
      const res = await setPersonalUseDeclared(true).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      setOpen(false);
      toast(t("Anotado: uso personal. No volverá a salir el recordatorio."), "success");
      router.refresh();
    });
  };

  return (
    <aside
      aria-label={t("Recordatorio de licencia")}
      data-testid="license-nudge"
      className="flex shrink-0 items-start gap-2 border-b border-brand-100 bg-brand-50 px-3 py-1.5 text-sm text-slate-700 max-sm:py-1 max-sm:text-xs max-lg:[body:has([aria-modal=true])_&]:hidden dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-slate-200"
    >
      <KeyRound size={15} className="mt-1 shrink-0 max-sm:hidden text-brand-600 dark:text-brand-300" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="mr-1 min-w-0">
          {t("¿Usas Pizarro en una empresa o para trabajar? Necesitas una licencia ({price} € + IVA, pago único). Gratis para uso personal.", { price: LICENSE_PRICE_EUR })}
        </p>
        <span className="flex flex-wrap items-center gap-1">
          <Link href="/admin/license" className={btn} onClick={later} data-testid="license-nudge-have">{t("Ya tengo licencia")}</Link>
          <button type="button" className={btn} onClick={personal} disabled={pending} data-testid="license-nudge-personal">{t("Es uso personal")}</button>
          <a
            href={buyHref}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="rounded bg-brand-600 px-2 py-0.5 font-medium text-on-brand hover:bg-brand-700"
            data-testid="license-nudge-buy"
          >
            {t("Comprar")}
          </a>
          <button type="button" className={`${btn} text-slate-500 dark:text-slate-400`} onClick={later} data-testid="license-nudge-later">{t("Recordar más tarde")}</button>
        </span>
      </div>
    </aside>
  );
}
