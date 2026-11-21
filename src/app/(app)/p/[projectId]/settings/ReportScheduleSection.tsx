"use client";

import { useState } from "react";
import { saveReportSchedule } from "@/actions/report-schedule";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";
import type { ReportRecipientView } from "@/lib/report-recipient";

interface ReportScheduleValue {
  enabled: boolean;
  /** Destinatario guardado (null: aún no hay informe programado). */
  recipient: ReportRecipientView | null;
  /** 1 = lunes … 7 = domingo */
  weekday: number;
  hour: number;
}

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Informe PDF semanal por email del proyecto: destinatario, día de la semana y hora. El destinatario se elige de la lista
 * de personas del proyecto, por su nombre (nadie ve ni escribe el email de otra persona); un administrador puede poner
 * además una dirección externa en un proyecto de equipo.
 */
export function ReportScheduleSection({ projectId, initial, emailAvailable, timeZone, recipients, people, currentUserId }: {
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
  /** Personas a las que puede ir, por nombre. */
  people: { id: string; name: string }[];
  currentUserId: string;
}) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [hour, setHour] = useState(initial.hour);
  const external = initial.recipient?.kind === "external" ? initial.recipient.shown : null;
  const [choice, setChoice] = useState(() =>
    initial.recipient?.kind === "user" ? `user:${initial.recipient.userId}` : external !== null ? "keep" : `user:${people.some((p) => p.id === currentUserId) ? currentUserId : (people[0]?.id ?? "")}`,
  );
  const [otherEmail, setOtherEmail] = useState("");

  const recipient = choice === "keep" ? { keep: true as const } : choice === "other" ? { email: otherEmail } : { userId: choice.slice("user:".length) };

  return (
    <section className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{t("Informe semanal por email")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("El informe PDF del proyecto, cada semana a un correo.")}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveReportSchedule(projectId, { enabled, recipient, weekday, hour });
            toast(res.ok ? t("Informe semanal guardado") : res.error, res.ok ? "success" : "error");
          });
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("Enviar el informe cada semana")}
        </label>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="label mb-0" htmlFor="rs-recipient">{t("Destinatario")}</label>
              <InfoTip topic={t("Destinatario")}>
                {recipients === "any"
                  ? t("Elige a una persona del proyecto o, con «Otra dirección…», escribe una externa.")
                  : recipients === "team"
                    ? t("Elige a un miembro del proyecto o a un administrador (una dirección externa solo la pone un administrador).")
                    : t("Proyecto privado: elige a uno de sus miembros.")}{" "}
                {t("El informe se genera con tus permisos: deja de enviarse si pierdes el acceso al proyecto.")}
              </InfoTip>
            </div>
            <select id="rs-recipient" className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={`user:${p.id}`}>{p.id === currentUserId ? t("{name} (tú)", { name: p.name }) : p.name}</option>
              ))}
              {external !== null && <option value="keep">{t("Dirección externa: {email}", { email: external })}</option>}
              {recipients === "any" && <option value="other">{t("Otra dirección…")}</option>}
            </select>
            {choice === "other" && (
              <input
                type="email"
                className="input mt-2"
                value={otherEmail}
                onChange={(e) => setOtherEmail(e.target.value)}
                required
                maxLength={200}
                autoComplete="off"
                placeholder={t("nombre@example.com")}
                aria-label={t("Dirección externa")}
                data-testid="rs-email"
              />
            )}
          </div>
          <div>
            <label className="label" htmlFor="rs-weekday">{t("Día")}</label>
            <select id="rs-weekday" className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{t(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rs-hour">{t("Hora")}</label>
            <select id="rs-hour" className="input" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">{t("Hora de la app ({tz}).", { tz: timeZone })}</p>
        {!emailAvailable && enabled && <p className="text-xs text-amber-700 dark:text-amber-300">{t("El envío de emails aún no está configurado en el servidor.")}</p>}
        <button className="btn-primary" disabled={pending || (choice === "other" && !otherEmail.trim())}>{t("Guardar")}</button>
      </form>
    </section>
  );
}
