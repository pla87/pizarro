"use client";

import { CalendarPlus, Check, Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { calendarFeedUsage, createCalendarFeed, disableCalendarFeed, setCalendarFeedScope, suggestedCalendarFeedScope } from "@/actions/calendar-feed";
import { formatAgo, formatDate } from "@/lib/format";
import { actionThrowResult } from "@/lib/stale-action";
import { useIntlLocale, useT } from "@/i18n/client";
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
 * «Último uso: hace 2 h» / «Aún no se ha usado» (CalendarFeed.lastUsedAt, anotado como mucho una vez por hora), en el
 * idioma de la app; la fecha exacta, en la zona de la app, va en el título. Sirve para ver si alguien usa un enlace filtrado.
 */
function LastUsed({ at }: { at: string | null }) {
  const t = useT();
  const locale = useIntlLocale();
  if (!at) return <p className="text-xs text-slate-500" data-testid="feed-last-used">{t("Aún no se ha usado")}</p>;
  const ago = formatAgo(at, new Date(), locale);
  return (
    <p className="text-xs text-slate-500" data-testid="feed-last-used" title={t("{date} (se anota como mucho una vez por hora)", { date: formatDate(at, "dateTimeShort", locale) })}>
      {ago ? t("Último uso: {when}", { when: ago }) : t("Último uso: hace menos de una hora")}
    </p>
  );
}

/**
 * Suscripción al calendario (.ics vivo) desde Google/Apple/Outlook. El enlace solo se ve al generarlo (en la BD queda su
 * HMAC): para volver a verlo hay que regenerarlo, lo que invalida el anterior.
 */
export function CalendarSubscribe({ initialActive, initialScope, className }: { initialActive: boolean; initialScope: Scope | null; className?: string }) {
  const t = useT();
  const toast = useToast();
  const [active, setActive] = useState(initialActive);
  // null: sin suscripción y aún sin saber qué proponer; se pregunta al servidor al abrir el menú (no en cada visita).
  const [scope, setScope] = useState<Scope | null>(initialScope);
  const asked = useRef(false);
  const [links, setLinks] = useState<Links | null>(null);
  const [copied, setCopied] = useState(false);
  // Último uso del enlace: se pide cada vez que se abre el menú con una suscripción activa (undefined: aún no se sabe).
  const [lastUsed, setLastUsed] = useState<string | null | undefined>(undefined);
  const [pending, start] = useActionTransition();

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open && active) {
        void calendarFeedUsage()
          .catch((e) => actionThrowResult(e, t))
          .then((res) => {
            if (!res.ok) return;
            setLastUsed(res.data.lastUsedAt);
            // Desactivada entretanto (otra pestaña, o un administrador al forzar el cambio de contraseña).
            if (!res.data.active) {
              setActive(false);
              setLinks(null);
            }
          });
      }
      if (!open || scope !== null || asked.current) return;
      asked.current = true;
      void suggestedCalendarFeedScope()
        .catch((e) => actionThrowResult(e, t))
        // Si no se puede saber (sin conexión…), «Todas»: con «Solo las mías» el calendario podría salir vacío.
        .then((res) => setScope((cur) => cur ?? (res.ok ? res.data : "ALL")));
    },
    [active, scope, t],
  );

  const generate = (next: Scope = scope ?? "ALL") =>
    start(async () => {
      const res = await createCalendarFeed(next);
      if (!res.ok) return toast(res.error, "error");
      setLinks(res.data);
      setActive(true);
      setCopied(false);
      // Enlace nuevo: aún nadie lo ha usado.
      setLastUsed(null);
    });

  const changeScope = (next: Scope) => {
    const prev = scope;
    setScope(next);
    if (!active) return;
    start(async () => {
      const res = await setCalendarFeedScope(next);
      if (!res.ok) {
        setScope(prev);
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
      setLastUsed(undefined);
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
      onOpenChange={onOpenChange}
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
        <p className="text-slate-600 dark:text-slate-300">{t("Tus fechas límite y entregables en Google Calendar, Apple Calendar u Outlook, siempre al día.")}</p>

        {scope === null ? (
          <p className="flex items-center gap-2 text-slate-500" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {t("Cargando…")}
          </p>
        ) : (
          <fieldset>
            <legend className="mb-1 font-medium">{t("Qué incluye")}</legend>
            {/* Cada opción explica qué entra: con «Solo las mías», las tareas sin responsable (habituales en casa) no salen. */}
            <label className="flex cursor-pointer items-start gap-2 py-0.5">
              <input type="radio" name="feed-scope" checked={scope === "MINE"} onChange={() => changeScope("MINE")} aria-describedby="feed-scope-mine" className="mt-1 accent-brand-600" />
              <span>
                {t("Solo las tareas asignadas a mí")}
                <span id="feed-scope-mine" className="block text-xs text-slate-500">{t("Las tuyas y los entregables donde tienes alguna. Las que no tienen responsable no salen.")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 py-0.5">
              <input type="radio" name="feed-scope" checked={scope === "ALL"} onChange={() => changeScope("ALL")} aria-describedby="feed-scope-all" className="mt-1 accent-brand-600" />
              <span>
                {t("Todas las de mis proyectos")}
                <span id="feed-scope-all" className="block text-xs text-slate-500">{t("Tareas y entregables, con o sin responsable.")}</span>
              </span>
            </label>
            <p className="mt-1 text-xs text-slate-500">{t("Solo tareas con fecha límite y sin terminar.")}</p>
          </fieldset>
        )}

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
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("Ya tienes una suscripción activa. El enlace no se vuelve a mostrar; si lo necesitas, regenéralo.")}</p>
        ) : null}
        {active && lastUsed !== undefined && <LastUsed at={lastUsed} />}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <button type="button" onClick={() => generate()} disabled={pending || scope === null} className={cn(btn, !active && "border-brand-600 bg-brand-600 text-on-brand hover:bg-brand-700 dark:border-brand-600 dark:hover:bg-brand-700")}>
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
