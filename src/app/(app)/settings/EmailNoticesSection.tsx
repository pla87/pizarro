"use client";

import { AlertTriangle, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { updateEmailPrefs } from "@/actions/collab-prefs";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";

type EmailPrefs = {
  /** Casilla principal: apagada, ningún email de avisos ni resumen. */
  emailNotices: boolean;
  /** Emails de administración (siempre al momento). */
  notifyAdminEmail: boolean;
  /** Menciones en tareas y notas. */
  notifyEmail: boolean;
  notifyAssignedEmail: boolean;
  notifyDueEmail: boolean;
  notifyCommentEmail: boolean;
  /** Frecuencia de los emails sobre proyectos: true = resumen diario, false = al momento. */
  dailyDigest: boolean;
  digestHour: number;
};

interface Props {
  prefs: EmailPrefs;
  emailAvailable: boolean;
  /** Administrador: la casilla de administración lleva su título completo (los demás la ven como «Avisos importantes») y puede configurar el email. */
  adminNotices: boolean;
  /** Zona horaria de la app (la hora del resumen es de esa zona). */
  timeZone: string;
}

/**
 * «Avisos por email» de Mi perfil → Avisos, como la sección de avisos push: una casilla principal y, solo si está marcada,
 * sus opciones, con un solo botón que lo guarda todo a la vez. Dos grupos: emails de administración de Pizarro (siempre al
 * momento; la casilla la ven todos: quien no es administrador también recibe avisos importantes, como que le añadan a un
 * proyecto, y se llama «Avisos importantes») y emails sobre proyectos (menciones, asignaciones, fechas, comentarios), con su
 * frecuencia: al momento o en el resumen diario (con su hora). En la app (la campana) los avisos se crean siempre.
 * Telegram y WhatsApp van en su propia tarjeta (MessagingSection).
 */
export function EmailNoticesSection({ prefs, emailAvailable, adminNotices, timeZone }: Props) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [form, setForm] = useState(prefs);
  // Lo guardado: sin cambios, «Guardar avisos» no haría nada y queda desactivado.
  const [saved, setSaved] = useState(prefs);
  const dirty = (Object.keys(form) as (keyof EmailPrefs)[]).some((k) => form[k] !== saved[k]);
  const projectBoxes = [
    ["notifyEmail", t("Menciones en tareas y notas")],
    ["notifyAssignedEmail", t("Cuando me asignan una tarea")],
    ["notifyDueEmail", t("Cambios de fecha límite y recordatorios")],
    ["notifyCommentEmail", t("Comentarios y respuestas en tareas que sigo")],
  ] as const;
  const set = <K extends keyof EmailPrefs>(key: K, value: EmailPrefs[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card p-5" data-testid="email-notices">
      <h2 className="flex items-center gap-2 font-semibold"><Mail size={17} /> {t("Avisos por email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Notificaciones por email")}</p>
      {/* Sin email en el servidor, arriba y destacado (antes, una línea gris al final con las casillas como si funcionaran).
          Las casillas se pueden seguir marcando (se guardan para cuando se configure), pero sus textos se ven atenuados: en gris
          (slate-500, 4,7:1 sobre blanco) y no con transparencia, que dejaba las ayudas de debajo en 2,3:1. */}
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
        className={cn("mt-4 space-y-4", !emailAvailable && "[&_label]:text-slate-500 dark:[&_label]:text-slate-400")}
        onSubmit={(e) => {
          e.preventDefault();
          const sent = form;
          start(async () => {
            const res = await updateEmailPrefs({
              emailNotices: sent.emailNotices, notifyEmail: sent.notifyEmail, notifyAssignedEmail: sent.notifyAssignedEmail, notifyDueEmail: sent.notifyDueEmail,
              notifyCommentEmail: sent.notifyCommentEmail, dailyDigest: sent.dailyDigest, digestHour: sent.digestHour,
              notifyAdminEmail: sent.notifyAdminEmail,
            });
            toast(res.ok ? t("Preferencias guardadas") : res.error, res.ok ? "success" : "error");
            if (res.ok) setSaved(sent);
          });
        }}
      >
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="email-notices" checked={form.emailNotices} onChange={(e) => set("emailNotices", e.target.checked)} aria-expanded={form.emailNotices} aria-controls="email-notices-options" />
          {t("Recibir avisos por email")}
        </label>
        {form.emailNotices && (
          <div id="email-notices-options" className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-slate-500">{adminNotices ? t("Emails de administración de Pizarro") : t("Emails importantes de Pizarro")}</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" name="email-admin" checked={form.notifyAdminEmail} onChange={(e) => set("notifyAdminEmail", e.target.checked)} />
                <span>
                  {adminNotices ? t("Avisos de administración") : t("Avisos importantes")}
                  <span className="block text-xs text-slate-500">
                    {adminNotices ? t("Pocos y urgentes: salen siempre al momento.") : t("Cuando te añaden a un proyecto o te afecta un cambio de un administrador. Siempre al momento.")}
                  </span>
                </span>
              </label>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-slate-500">{t("Emails sobre proyectos")}</legend>
              {projectBoxes.map(([key, label]) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" name={`email-${key}`} checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                <label htmlFor="email-frequency">{t("Frecuencia de los emails")}</label>
                <select
                  id="email-frequency" className="input w-auto py-1" data-testid="email-frequency"
                  value={form.dailyDigest ? "DIGEST" : "NOW"} onChange={(e) => set("dailyDigest", e.target.value === "DIGEST")}
                >
                  <option value="NOW">{t("Al momento")}</option>
                  <option value="DIGEST">{t("Resumen diario")}</option>
                </select>
                {form.dailyDigest && (
                  <>
                    <label htmlFor="digest-hour">{t("a las")}</label>
                    <select id="digest-hour" className="input w-auto py-1" value={form.digestHour} onChange={(e) => set("digestHour", Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">({timeZone})</span>
                  </>
                )}
              </div>
              {form.dailyDigest && !projectBoxes.some(([key]) => form[key]) && (
                <p role="status" className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {t("Con el resumen diario y ninguna casilla de emails sobre proyectos marcada, no te llegará ningún resumen.")}
                </p>
              )}
            </fieldset>
          </div>
        )}
        <button className="btn-primary" disabled={pending || !dirty}>{t("Guardar avisos")}</button>
      </form>
    </section>
  );
}
