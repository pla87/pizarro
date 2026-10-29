"use client";

import { useId } from "react";
import { useT } from "@/i18n/client";
import { fieldsError, type FieldsForm } from "@/lib/fields-form";
import { HOURS_STEP, MAX_CLIENT, PRIORITY_LABEL, TASK_PRIORITIES, type TaskFieldKey } from "@/lib/task-fields";

export { EMPTY_FIELDS_FORM, fieldsError, fieldsForCreate, fieldsFormOf, fieldsPatch, type FieldsForm } from "@/lib/fields-form";

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
          <div className="min-w-0">
            <label className="label" htmlFor={`${uid}-cost`}>{t("Coste")}</label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input id={`${uid}-cost`} type="number" inputMode="decimal" min={0} step={0.01} className="input py-1 pr-7" value={value.cost} onChange={(e) => onChange({ cost: e.target.value })} />
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
              <input id={`${uid}-est`} type="number" inputMode="decimal" min={0} step={HOURS_STEP} className="input py-1" value={value.estimatedHours} onChange={(e) => onChange({ estimatedHours: e.target.value })} />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor={`${uid}-act`}>{t("Horas reales")}</label>
              <input id={`${uid}-act`} type="number" inputMode="decimal" min={0} step={HOURS_STEP} className="input py-1" value={value.actualHours} onChange={(e) => onChange({ actualHours: e.target.value })} />
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
        {has("externalUrl") && (
          <div className="col-span-2 min-w-0">
            <label className="label" htmlFor={`${uid}-url`}>{t("Enlace de referencia")}</label>
            <input id={`${uid}-url`} type="url" inputMode="url" className="input py-1" placeholder="https://" value={value.externalUrl} maxLength={2000} onChange={(e) => onChange({ externalUrl: e.target.value })} />
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </fieldset>
  );
}
