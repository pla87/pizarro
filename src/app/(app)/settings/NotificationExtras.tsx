"use client";

import { Bell, CalendarDays } from "lucide-react";
import { useState, useTransition } from "react";
import { updateCollabPrefs } from "@/actions/collab-prefs";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

interface Props {
  prefs: { notifyAssignedEmail: boolean; notifyDueEmail: boolean; notifyCommentEmail: boolean; dailyDigest: boolean; digestHour: number };
  emailAvailable: boolean;
  /** Zona horaria de la app (la hora del resumen es de esa zona). */
  timeZone: string;
}

/** Avisos por email de asignaciones, fechas y comentarios, y resumen diario. En la app los avisos se crean siempre. */
export function NotificationExtras({ prefs, emailAvailable, timeZone }: Props) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(prefs);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Bell size={17} /> {t("Otros avisos y resumen diario")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {t("Las asignaciones, los cambios de fecha de tus tareas y los comentarios de las tareas que sigues siempre te aparecen en la campana de avisos. Además puedes recibirlos por email:")}
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateCollabPrefs(form);
            toast(res.ok ? t("Preferencias guardadas") : res.error, res.ok ? "success" : "error");
          });
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyAssignedEmail} onChange={(e) => set("notifyAssignedEmail", e.target.checked)} />
          <span>{t("Email cuando me asignan una tarea")}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.notifyDueEmail} onChange={(e) => set("notifyDueEmail", e.target.checked)} />
          <span>{t("Email cuando cambia la fecha límite de una tarea mía")}</span>
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
              <span className="block text-xs text-slate-500">{t("Lo ocurrido en las últimas 24 horas en tus proyectos y lo que te toca hoy. Si no hay novedades, no se envía.")}</span>
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
        {!emailAvailable && (form.notifyAssignedEmail || form.notifyDueEmail || form.notifyCommentEmail || form.dailyDigest) && (
          <p className="text-xs text-slate-500">{t("El envío de emails aún no está configurado en el servidor.")}</p>
        )}
        <button className="btn-primary" disabled={pending}>{t("Guardar avisos")}</button>
      </form>
    </section>
  );
}
