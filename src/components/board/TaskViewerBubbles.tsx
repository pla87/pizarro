"use client";

import { useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { useTaskViewers } from "./taskPresence";

const MAX_SHOWN = 2;

/** Círculos en la esquina superior izquierda de la tarjeta con las otras personas que tienen abierta la tarea. */
export function TaskViewerBubbles({ taskId }: { taskId: string }) {
  const t = useT();
  const viewers = useTaskViewers(taskId);
  if (viewers.length === 0) return null;
  const extra = viewers.length - MAX_SHOWN;
  const hidden = viewers.slice(MAX_SHOWN).map((v) => v.name).join(", ");
  return (
    <div className="pointer-events-none absolute -top-1.5 -left-1.5 z-10 flex -space-x-1.5">
      {viewers.slice(0, MAX_SHOWN).map((v) => (
        <span key={v.id} className="pointer-events-auto rounded-full ring-2 ring-white dark:ring-slate-900">
          <Avatar id={v.id} name={v.name} title={t("{name} tiene abierta esta tarea", { name: v.name })} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="pointer-events-auto flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-900"
          title={t(viewers.length - MAX_SHOWN > 1 ? "{names} tienen abierta esta tarea" : "{name} tiene abierta esta tarea", { name: hidden, names: hidden })}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
