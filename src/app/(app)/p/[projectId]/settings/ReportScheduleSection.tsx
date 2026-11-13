"use client";

import { useState, useTransition } from "react";
import { saveReportSchedule } from "@/actions/report-schedule";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

interface ReportScheduleValue {
  enabled: boolean;
  recipient: string;
  /** 1 = lunes … 7 = domingo */
  weekday: number;
  hour: number;
}

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Informe PDF semanal por email del proyecto: destinatario, día de la semana y hora. */
export function ReportScheduleSection({ projectId, initial, emailAvailable, timeZone, recipients }: {
  projectId: string;
  initial: ReportScheduleValue;
  emailAvailable: boolean;
  timeZone: string;
  /**
   * A quién puede ir (las reglas de report-recipient.ts): «any» = administrador en un proyecto de equipo (también una
   * dirección externa), «team» = miembro en un proyecto de equipo (miembros y administradores), «members» = proyecto
   * privado (solo sus miembros).
   */
  recipients: "any" | "team" | "members";
}) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(initial);
  const set = <K extends keyof ReportScheduleValue>(key: K, value: ReportScheduleValue[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{t("Informe semanal por email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("El informe PDF del proyecto, cada semana a un correo.")}</p>
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
            <div className="mb-1 flex items-center gap-1">
              <label className="label mb-0" htmlFor="rs-recipient">{t("Destinatario")}</label>
              <InfoTip topic={t("Destinatario")}>
                {recipients === "any"
                  ? t("Vale la dirección de un miembro del proyecto, la de un administrador o una externa.")
                  : recipients === "team"
                    ? t("Vale la dirección de un miembro del proyecto o la de un administrador (una externa solo la pone un administrador).")
                    : t("Proyecto privado: solo vale la dirección de uno de sus miembros.")}{" "}
                {t("El informe se genera con tus permisos: deja de enviarse si pierdes el acceso al proyecto.")}
              </InfoTip>
            </div>
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
        <p className="text-xs text-slate-500">{t("Hora de la app ({tz}).", { tz: timeZone })}</p>
        {!emailAvailable && form.enabled && <p className="text-xs text-amber-700 dark:text-amber-300">{t("El envío de emails aún no está configurado en el servidor.")}</p>}
        <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
      </form>
    </section>
  );
}
