"use client";

import { useState, useTransition } from "react";
import { saveReportSchedule } from "@/actions/report-schedule";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

export interface ReportScheduleValue {
  enabled: boolean;
  recipient: string;
  /** 1 = lunes … 7 = domingo */
  weekday: number;
  hour: number;
}

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Informe PDF semanal por email del proyecto: destinatario, día de la semana y hora. */
export function ReportScheduleSection({ projectId, initial, emailAvailable, timeZone }: {
  projectId: string;
  initial: ReportScheduleValue;
  emailAvailable: boolean;
  timeZone: string;
}) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(initial);
  const set = <K extends keyof ReportScheduleValue>(key: K, value: ReportScheduleValue[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{t("Informe semanal por email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Envía el informe PDF de estado del proyecto a un correo cada semana, el día y la hora que elijas.")}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveReportSchedule(projectId, form);
            toast(res.ok ? t("Informe semanal guardado") : res.error, res.ok ? "success" : "error");
          });
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          {t("Enviar el informe cada semana")}
        </label>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div>
            <label className="label" htmlFor="rs-recipient">{t("Destinatario")}</label>
            <input id="rs-recipient" type="email" className="input" value={form.recipient} onChange={(e) => set("recipient", e.target.value)} required maxLength={200} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="rs-weekday">{t("Día")}</label>
            <select id="rs-weekday" className="input" value={form.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{t(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rs-hour">{t("Hora")}</label>
            <select id="rs-hour" className="input" value={form.hour} onChange={(e) => set("hour", Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">{t("Hora de la app ({tz}). Cualquier dirección es válida; el informe se genera con tus permisos, así que deja de enviarse si pierdes el acceso al proyecto.", { tz: timeZone })}</p>
        {!emailAvailable && form.enabled && <p className="text-xs text-amber-700 dark:text-amber-300">{t("El envío de emails aún no está configurado en el servidor.")}</p>}
        <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
      </form>
    </section>
  );
}
