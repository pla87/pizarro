"use client";

import { useT } from "@/i18n/client";
import { TASK_FIELDS, TASK_FIELD_LABEL, type TaskFieldKey } from "@/lib/task-fields";

const HINT: Record<TaskFieldKey, string> = {
  cost: "Importe en € de la tarea y si está pagado.",
  hours: "Horas estimadas y horas reales (de 0,25 en 0,25).",
  priority: "Baja, media, alta o urgente, con insignia en la tarjeta.",
  client: "Texto corto (hasta 120 caracteres) con sugerencias de los clientes ya usados.",
  startDate: "Debe ser anterior o igual a la fecha límite.",
};

/** Interruptores de los campos opcionales de las tareas (ajustes del proyecto y plantillas). */
export function TaskFieldToggles({
  value,
  onChange,
  disabled,
  lockedCost,
}: {
  value: readonly TaskFieldKey[];
  onChange: (next: TaskFieldKey[]) => void;
  disabled?: boolean;
  /** Explicación de por qué el coste no se puede desactivar (hay una columna de presupuesto). */
  lockedCost?: string | null;
}) {
  const t = useT();
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {TASK_FIELDS.map((key) => {
        const on = value.includes(key);
        const locked = key === "cost" && on && Boolean(lockedCost);
        return (
          <li key={key} className="flex items-start gap-3 py-2">
            <input
              id={`taskfield-${key}`}
              type="checkbox"
              role="switch"
              className="mt-1"
              checked={on}
              disabled={disabled || locked}
              onChange={(e) => onChange(TASK_FIELDS.filter((f) => (f === key ? e.target.checked : value.includes(f))))}
            />
            <label htmlFor={`taskfield-${key}`} className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{t(TASK_FIELD_LABEL[key])}</span>
              <span className="block text-xs text-slate-500">{t(HINT[key])}</span>
              {locked && <span className="block text-xs text-amber-700 dark:text-amber-400">{lockedCost}</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
