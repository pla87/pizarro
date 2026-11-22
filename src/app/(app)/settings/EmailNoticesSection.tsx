"use client";

import { AlertTriangle, CalendarDays, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { updateEmailPrefs } from "@/actions/collab-prefs";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";

type EmailPrefs = {
  notifyEmail: boolean;
  notifyAssignedEmail: boolean;
  notifyDueEmail: boolean;
  notifyCommentEmail: boolean;
  dailyDigest: boolean;
  digestHour: number;
};

interface Props {
  prefs: EmailPrefs;
  emailAvailable: boolean;
  /** Administrador: con las menciones salen también los avisos de administración. */
  adminNotices: boolean;
  /** Zona horaria de la app (la hora del resumen es de esa zona). */
  timeZone: string;
}

/**
 * «Avisos por email» de Mi perfil → Avisos: todas las casillas de email (menciones, asignaciones, fechas y «Esperando»,
 * comentarios, resumen diario y su hora) en una sola tarjeta con un solo botón, que lo guarda todo a la vez. Antes iban
 * en dos tarjetas con su propio «Guardar avisos» cada una, y lo marcado en una se perdía al guardar la otra. En la app
 * (la campana) los avisos se crean siempre. Telegram y WhatsApp van en su propia tarjeta (MessagingSection).
 */
export function EmailNoticesSection({ prefs, emailAvailable, adminNotices, timeZone }: Props) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [form, setForm] = useState(prefs);
  // Lo guardado: sin cambios, «Guardar avisos» no haría nada y queda desactivado.
  const [saved, setSaved] = useState(prefs);
  const dirty = (Object.keys(form) as (keyof EmailPrefs)[]).some((k) => form[k] !== saved[k]);
  const set = <K extends keyof EmailPrefs>(key: K, value: EmailPrefs[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Mail size={17} /> {t("Avisos por email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {t("Menciones, asignaciones, cambios de fecha y comentarios de lo que sigues salen siempre en la campana; además, por email:")}
      </p>
      {/* Sin email en el servidor, arriba y destacado (antes, una línea gris al final con las casillas como si funcionaran).
          Las casillas se pueden seguir marcando (se guardan para cuando se configure), pero se ven atenuadas. */}
      {!emailAvailable && (
        <p role="status" data-email-unavailable className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t("El envío de emails aún no está configurado en el servidor: de momento no se envía ningún email. Lo que marques aquí se guarda y valdrá cuando se configure.")}
            {adminNotices && <>{" "}<Link href="/admin/integrations" className="font-medium underline">{t("Configurar el email")}</Link></>}
          </span>
        </p>
      )}
      <form
        className={cn("mt-4 space-y-3", !emailAvailable && "[&_label]:opacity-60")}
        onSubmit={(e) => {
          e.preventDefault();
          const sent = form;
          start(async () => {
            const res = await updateEmailPrefs(sent);
            toast(res.ok ? t("Preferencias guardadas") : res.error, res.ok ? "success" : "error");
            if (res.ok) setSaved(sent);
          });
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyEmail} onChange={(e) => set("notifyEmail", e.target.checked)} />
          <span>
            {t("Email cuando me mencionan")}
            {/* A todo el mundo (cualquiera puede configurar un informe): este aviso va con las menciones (noticeEmailKind).
                Telegram y WhatsApp tienen sus propias casillas en su tarjeta: aquí solo se habla del email. */}
            <span className="block text-xs text-slate-500">
              {adminNotices
                ? t("Además de las menciones, esta casilla te envía el aviso de que alguien se ha dado de baja de un informe semanal que configuraste y, como administrador, el de que un proyecto privado ha pasado a ser de equipo al borrarse una cuenta.")
                : t("Además de las menciones, esta casilla te envía el aviso de que alguien se ha dado de baja de un informe semanal que configuraste.")}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyAssignedEmail} onChange={(e) => set("notifyAssignedEmail", e.target.checked)} />
          <span>{t("Email cuando me asignan una tarea")}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyDueEmail} onChange={(e) => set("notifyDueEmail", e.target.checked)} />
          <span>{t("Email con los cambios de fecha límite y los recordatorios de «Esperando»")}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyCommentEmail} onChange={(e) => set("notifyCommentEmail", e.target.checked)} />
          <span>{t("Email con los comentarios y respuestas en tareas que sigo")}</span>
        </label>
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.dailyDigest} onChange={(e) => set("dailyDigest", e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-medium"><CalendarDays size={15} /> {t("Resumen diario por email")}</span>
              <span className="block text-xs text-slate-500">{t("Lo ocurrido en 24 horas en tus proyectos y lo que te toca hoy. Sin novedades, no se envía.")}</span>
            </span>
          </label>
          {form.dailyDigest && (
            <div className="mt-2 ml-6 flex items-center gap-2 text-sm">
              <label htmlFor="digest-hour">{t("Enviar a las")}</label>
              <select id="digest-hour" className="input w-auto py-1" value={form.digestHour} onChange={(e) => set("digestHour", Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
              </select>
              <span className="text-xs text-slate-500">({timeZone})</span>
            </div>
          )}
        </div>
        <button className="btn-primary" disabled={pending || !dirty}>{t("Guardar avisos")}</button>
      </form>
    </section>
  );
}
