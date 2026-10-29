"use client";

import { Copy, FileDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getColumnChecklist } from "@/actions/column-views";
import { updateSubtask } from "@/actions/tasks";
import { checklistMarkdown, groupChecklist, type ChecklistGroupBy, type ChecklistItem } from "@/lib/checklist";
import type { BoardColumn } from "@/lib/types";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { copyText } from "../ui/clipboard";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

/**
 * «Ver lista» de una columna con rol Lista consolidada: las subtareas de todas sus tarjetas en una sola lista,
 * por tarjeta o por tipo. Marcar una casilla marca la subtarea original (acción deshacible).
 */
export function ChecklistDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const { project, patchTask, track } = useBoard();
  const toast = useToast();
  const t = useT();
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [by, setBy] = useState<ChecklistGroupBy>("card");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getColumnChecklist(project.id, column.id).then((res) => {
      if (!alive) return;
      if (res.ok) setItems(res.data.items);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [project.id, column.id]);

  const groups = useMemo(() => groupChecklist(items ?? [], by), [items, by]);
  const done = (items ?? []).filter((i) => i.done).length;

  const toggle = async (item: ChecklistItem) => {
    const next = !item.done;
    const set = (value: boolean) => setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, done: value } : i)) ?? list);
    const count = (delta: number) => patchTask(item.taskId, (task) => ({ subtaskDone: Math.max(0, task.subtaskDone + delta) }));
    set(next);
    count(next ? 1 : -1);
    const res = await track(updateSubtask(item.id, { done: next }));
    if (!res.ok) {
      set(item.done);
      count(next ? -1 : 1);
      toast(res.error, "error");
    }
  };

  const copy = async () => {
    const ok = await copyText(checklistMarkdown(groups, by, column.name));
    toast(ok ? t("Lista copiada") : t("No se pudo copiar"), ok ? "success" : "error");
  };
  const pdf = () => window.open(`/api/projects/${project.id}/columns/${column.id}/checklist?by=${by}`, "_blank", "noopener");

  const modes: [ChecklistGroupBy, string][] = [["card", t("Por tarjeta")], ["kind", t("Por tipo de tarea")]];

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`${t("Lista consolidada")} · ${column.name}`}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-slate-500">{items ? t("{done} de {total} hechas", { done, total: items.length }) : ""}</span>
          <button className="btn-secondary min-h-10" onClick={copy} disabled={!items?.length}><Copy size={15} /> {t("Copiar como texto")}</button>
          <button className="btn-secondary min-h-10" onClick={pdf} disabled={!items?.length}><FileDown size={15} /> PDF</button>
        </div>
      }
    >
      <div role="radiogroup" aria-label={t("Agrupar")} className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
        {modes.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={by === value}
            onClick={() => setBy(value)}
            className={cn("min-h-9 rounded-md px-3 text-sm", by === value ? "bg-white font-medium shadow-sm dark:bg-slate-700" : "text-slate-600 dark:text-slate-400")}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && items === null && <p className="py-6 text-center text-sm text-slate-400">{t("Cargando…")}</p>}
      {items && items.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{t("No hay subtareas en esta columna.")}</p>}
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
              <span className="min-w-0 truncate">{g.label}</span>
              <span className="text-xs font-normal text-slate-500">{g.items.filter((i) => i.done).length}/{g.items.length}</span>
            </h3>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={it.done} onChange={() => toggle(it)} />
                    <span className={cn("min-w-0 text-sm [overflow-wrap:anywhere]", it.done && "text-slate-400 line-through")}>
                      {it.title}
                      {by === "kind" && <span className="block text-xs text-slate-500 no-underline">{it.taskTitle}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
