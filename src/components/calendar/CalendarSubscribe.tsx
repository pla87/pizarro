"use client";

import { CalendarPlus, Check, Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { createCalendarFeed, disableCalendarFeed, setCalendarFeedScope } from "@/actions/calendar-feed";
import { useT } from "@/i18n/client";
import { cn } from "@/components/ui/cn";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";
import { useActionTransition } from "@/components/useActionTransition";

type Scope = "MINE" | "ALL";
interface Links {
  https: string;
  webcal: string;
  google: string;
}

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800";

/**
 * Suscripción al calendario (.ics vivo) desde Google/Apple/Outlook. El enlace solo se ve al generarlo (en la BD queda su
 * HMAC): para volver a verlo hay que regenerarlo, lo que invalida el anterior.
 */
export function CalendarSubscribe({ initialActive, initialScope, className }: { initialActive: boolean; initialScope: Scope; className?: string }) {
  const t = useT();
  const toast = useToast();
  const [active, setActive] = useState(initialActive);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [links, setLinks] = useState<Links | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useActionTransition();

  const generate = (next: Scope = scope) =>
    start(async () => {
      const res = await createCalendarFeed(next);
      if (!res.ok) return toast(res.error, "error");
      setLinks(res.data);
      setActive(true);
      setCopied(false);
    });

  const changeScope = (next: Scope) => {
    setScope(next);
    if (!active) return;
    start(async () => {
      const res = await setCalendarFeedScope(next);
      if (!res.ok) {
        setScope(scope);
        toast(res.error, "error");
      }
    });
  };

  const disable = () =>
    start(async () => {
      const res = await disableCalendarFeed();
      if (!res.ok) return toast(res.error, "error");
      setActive(false);
      setLinks(null);
      toast(t("Suscripción desactivada"));
    });

  const copy = async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.https);
      setCopied(true);
      toast(t("Enlace copiado"));
    } catch {
      toast(t("No se pudo copiar el enlace"), "error");
    }
  };

  return (
    <Popover
      kind="dialog"
      label={t("Suscribirse al calendario")}
      align="end"
      panelClassName="w-[26rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      trigger={({ props }) => (
        <button type="button" {...props} className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800", className)}>
          <CalendarPlus size={15} aria-hidden />
          <span className="hidden sm:inline">{t("Suscribirse")}</span>
          <span className="sm:hidden sr-only">{t("Suscribirse al calendario")}</span>
        </button>
      )}
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600 dark:text-slate-300">{t("Añade tus fechas límite y entregables a Google Calendar, Apple Calendar u Outlook. El calendario se actualiza solo.")}</p>

        <fieldset>
          <legend className="mb-1 font-medium">{t("Qué incluye")}</legend>
          {/* Cada opción explica qué entra: con «Solo las mías», las tareas sin responsable (habituales en casa) no salen. */}
          <label className="flex cursor-pointer items-start gap-2 py-0.5">
            <input type="radio" name="feed-scope" checked={scope === "MINE"} onChange={() => changeScope("MINE")} aria-describedby="feed-scope-mine" className="mt-1 accent-brand-600" />
            <span>
              {t("Solo las tareas asignadas a mí")}
              <span id="feed-scope-mine" className="block text-xs text-slate-500">{t("Las tareas de las que eres responsable y los entregables en los que tienes alguna. Las tareas sin responsable no salen.")}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 py-0.5">
            <input type="radio" name="feed-scope" checked={scope === "ALL"} onChange={() => changeScope("ALL")} aria-describedby="feed-scope-all" className="mt-1 accent-brand-600" />
            <span>
              {t("Todas las de mis proyectos")}
              <span id="feed-scope-all" className="block text-xs text-slate-500">{t("Todas las tareas y entregables de los proyectos en los que trabajas, tengan responsable o no.")}</span>
            </span>
          </label>
          <p className="mt-1 text-xs text-slate-500">{t("En los dos casos, solo las tareas con fecha límite que no están terminadas.")}</p>
        </fieldset>

        {links ? (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block font-medium">{t("Enlace privado")}</span>
              <input readOnly value={links.https} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <p className="text-xs text-amber-700 dark:text-amber-300">{t("Cualquiera con este enlace ve tus fechas: no lo compartas. Solo se muestra ahora; si lo pierdes, genera uno nuevo.")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} className={btn}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {t("Copiar enlace")}
              </button>
              <a href={links.google} target="_blank" rel="noopener noreferrer" className={btn}>
                <ExternalLink size={14} aria-hidden />
                {t("Abrir en Google Calendar")}
              </a>
              <a href={links.webcal} className={btn}>
                <ExternalLink size={14} aria-hidden />
                {t("Abrir en Apple Calendar")}
              </a>
            </div>
          </div>
        ) : active ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("Ya tienes una suscripción activa. Por seguridad el enlace no se vuelve a mostrar: genera uno nuevo para verlo (el anterior dejará de funcionar).")}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <button type="button" onClick={() => generate()} disabled={pending} className={cn(btn, !active && "border-brand-600 bg-brand-600 text-on-brand hover:bg-brand-700 dark:border-brand-600 dark:hover:bg-brand-700")}>
            {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : active ? <RefreshCw size={14} aria-hidden /> : <CalendarPlus size={14} aria-hidden />}
            {active ? t("Regenerar enlace") : t("Generar enlace de suscripción")}
          </button>
          {active && (
            <button type="button" onClick={disable} disabled={pending} className={cn(btn, "text-red-700 dark:text-red-300")}>
              <Trash2 size={14} aria-hidden />
              {t("Desactivar")}
            </button>
          )}
        </div>
        {active && <p className="text-xs text-slate-500">{t("Regenerar o desactivar deja sin efecto el enlace anterior en todos tus calendarios.")}</p>}
      </div>
    </Popover>
  );
}
