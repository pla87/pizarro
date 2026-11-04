"use client";

import { useId } from "react";
import { useT } from "@/i18n/client";
import { fieldsError, type FieldsForm } from "@/lib/fields-form";
import { HOURS_STEP, MAX_CLIENT, PRIORITY_LABEL, TASK_PRIORITIES, type TaskFieldKey } from "@/lib/task-fields";

export { EMPTY_FIELDS_FORM, fieldsError, fieldsForCreate, fieldsFormOf, fieldsPatch, type FieldsForm } from "@/lib/fields-form";

/**
 * Importe u horas: campo de texto con teclado decimal que admite coma o punto (el servidor entiende los dos). Con
 * type="number", Chrome en un sistema en inglés descartaba la coma al teclear («12,5» se guardaba como 125) y Firefox
 * dejaba el valor vacío (se borraba lo guardado). ↑ ↓ suman o restan `step`, como antes.
 */
function DecimalInput({ value, onChange, step, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "step" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  step: number;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey) return;
        const raw = value.trim();
        const comma = raw.includes(",");
        if (raw !== "" && !/^\d+([.,]\d*)?$/.test(raw)) return;
        e.preventDefault();
        const n = Math.max(0, Math.round(((raw === "" ? 0 : Number(raw.replace(",", "."))) + (e.key === "ArrowUp" ? step : -step)) * 100) / 100);
        const text = String(n);
        onChange(comma ? text.replace(".", ",") : text);
      }}
    />
  );
}

/** Grupo compacto «Campos» con los campos opcionales que el proyecto tiene activados. */
export function TaskFieldsGroup({
  enabled, value, onChange, onCommit, dueDate, clients = [], disabled = false,
}: {
  enabled: readonly TaskFieldKey[];
  value: FieldsForm;
  onChange: (patch: Partial<FieldsForm>) => void;
  /** Guardado al terminar de editar (al salir de un campo o al elegir en un selector); sin él, solo se rellena el formulario. */
  onCommit?: (next: FieldsForm) => void;
  dueDate?: string | null;
  /** Clientes ya usados en el proyecto (sugerencias). */
  clients?: string[];
  disabled?: boolean;
}) {
  const t = useT();
  const uid = useId();
  if (!enabled.length) return null;
  const error = fieldsError(value, enabled, dueDate, t);
  const has = (k: TaskFieldKey) => enabled.includes(k);
  /** Cambio que se guarda al momento (selector, casilla, fecha completa). */
  const change = (patch: Partial<FieldsForm>) => {
    onChange(patch);
    onCommit?.({ ...value, ...patch });
  };
  return (
    <fieldset className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700" disabled={disabled} onBlur={() => onCommit?.(value)}>
      <legend className="px-1 text-xs font-medium text-slate-500">{t("Campos")}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {has("priority") && (
          <div className="min-w-0">
            <label className="label" htmlFor={`${uid}-priority`}>{t("Prioridad")}</label>
            <select id={`${uid}-priority`} className="input py-1" value={value.priority} onChange={(e) => change({ priority: e.target.value })}>
              <option value="">{t("Sin prioridad")}</option>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABEL[p])}</option>)}
            </select>
          </div>
        )}
        {has("client") && (
          <div className="min-w-0">
            <label className="label" htmlFor={`${uid}-client`}>{t("Cliente")}</label>
            <input id={`${uid}-client`} className="input py-1" value={value.client} maxLength={MAX_CLIENT} list={`${uid}-clients`} autoComplete="off" onChange={(e) => onChange({ client: e.target.value })} />
            <datalist id={`${uid}-clients`}>{clients.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        )}
        {has("cost") && (
          <div className="col-span-2 min-w-0">
            <label className="label" htmlFor={`${uid}-cost`}>{t("Coste")}</label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <DecimalInput id={`${uid}-cost`} step={0.01} className="input py-1 pr-7" value={value.cost} onChange={(cost) => onChange({ cost })} />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-slate-500" aria-hidden>€</span>
              </div>
              <label className="flex shrink-0 items-center gap-1 text-xs">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={value.costPaid} onChange={(e) => change({ costPaid: e.target.checked })} />
                {t("Pagado")}
              </label>
            </div>
          </div>
        )}
        {has("hours") && (
          <>
            <div className="min-w-0">
              <label className="label" htmlFor={`${uid}-est`}>{t("Horas estimadas")}</label>
              <DecimalInput id={`${uid}-est`} step={HOURS_STEP} className="input py-1" value={value.estimatedHours} onChange={(estimatedHours) => onChange({ estimatedHours })} />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor={`${uid}-act`}>{t("Horas reales")}</label>
              <DecimalInput id={`${uid}-act`} step={HOURS_STEP} className="input py-1" value={value.actualHours} onChange={(actualHours) => onChange({ actualHours })} />
            </div>
          </>
        )}
        {has("startDate") && (
          <div className="min-w-0">
            <label className="label" htmlFor={`${uid}-start`}>{t("Fecha de inicio")}</label>
            <input id={`${uid}-start`} type="date" className="input py-1" value={value.startDate} max={dueDate || undefined} onChange={(e) => {
              // Al teclear el año, Chrome emite 0002, 0020…: solo se guarda una fecha completa y válida.
              const v = e.target.value;
              if (v === "" || v.slice(0, 4) >= "1900") change({ startDate: v });
              else onChange({ startDate: v });
            }} />
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </fieldset>
  );
}
