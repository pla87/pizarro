"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createTasks } from "@/actions/tasks";
import { MAX_BULK_TASKS, parseTaskLines } from "@/lib/bulk";
import { Modal } from "../ui/Modal";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { TypeSelector } from "./TaskDialog";

interface Props {
  initialColumnId?: string;
  onClose: () => void;
}

export function BulkTaskDialog({ initialColumnId, onClose }: Props) {
  const board = useBoard();
  const toast = useToast();
  const [columnId, setColumnId] = useState(initialColumnId ?? board.columns[0]?.id ?? "");
  const [text, setText] = useState("");
  // Hay que elegir el tipo; solo se preselecciona si no hay alternativa.
  const [kindId, setKindId] = useState(board.kinds.length === 1 ? board.kinds[0]!.id : "");
  // Tipo distinto para líneas concretas (por título).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [deliverableId, setDeliverableId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => parseTaskLines(text), [text]);
  const tooMany = lines.length > MAX_BULK_TASKS;
  const kindOf = (title: string) => overrides[title] || kindId;
  const missingKind = lines.some((l) => !kindOf(l));
  const extras = [assigneeId, dueDate, deliverableId].filter(Boolean).length + (labelIds.length ? 1 : 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines.length || tooMany || missingKind || !columnId) return;
    setBusy(true);
    const res = await board.track(
      createTasks({
        projectId: board.project.id,
        columnId,
        tasks: lines.map((title) => ({ title, kindId: kindOf(title) })),
        assigneeId: assigneeId || null,
        dueDate: dueDate || null,
        deliverableId: deliverableId || null,
        labelIds,
      }),
    );
    if (!res.ok) {
      setBusy(false);
      return toast(res.error, "error");
    }
    res.data.forEach(board.upsertTask);
    toast(res.data.length === 1 ? "1 tarea creada" : `${res.data.length} tareas creadas`);
    onClose();
  };

  const label = !lines.length
    ? "Crear tareas"
    : tooMany
      ? `Máximo ${MAX_BULK_TASKS} tareas`
      : missingKind
        ? "Elige el tipo"
        : lines.length === 1
          ? "Crear 1 tarea"
          : `Crear ${lines.length} tareas`;

  return (
    <Modal
      open
      onClose={onClose}
      title="Crear varias tareas"
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="bulk-tasks" className="btn-primary" disabled={busy || !lines.length || tooMany || missingKind}>
            {busy && <Loader2 size={16} className="animate-spin" />} {label}
          </button>
        </>
      }
    >
      <form id="bulk-tasks" onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="bt-column">Columna</label>
          <select id="bt-column" className="input" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bt-text">Tareas (una por línea)</label>
          <textarea
            id="bt-text"
            className="input field-sizing-content max-h-60 min-h-28"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pega aquí la lista"
            data-autofocus
          />
        </div>

        {lines.length > 0 && (
          <div className="space-y-2">
            <div className={cn("text-sm font-medium", tooMany && "text-red-600")}>
              {lines.length === 1 ? "1 tarea detectada" : `${lines.length} tareas detectadas`}
              {tooMany && ` · máximo ${MAX_BULK_TASKS}`}
            </div>
            <div>
              <div className="label">Tipo para todas</div>
              <TypeSelector
                kinds={board.kinds}
                value={kindId}
                onChange={(id) => {
                  // El tipo común se aplica a todas las líneas, también a las cambiadas a mano.
                  setKindId(id);
                  setOverrides({});
                }}
              />
            </div>
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {lines.map((title, i) => {
                const kind = board.kindById.get(kindOf(title));
                return (
                  <li key={`${i}-${title}`} className="flex items-center gap-2 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
                    <select
                      className="shrink-0 rounded-md border border-slate-300 bg-white py-0.5 pr-6 pl-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
                      style={kind ? { color: kind.color } : undefined}
                      value={kindOf(title)}
                      onChange={(e) => setOverrides((o) => ({ ...o, [title]: e.target.value }))}
                      aria-label={`Tipo de «${title}»`}
                    >
                      {!kindOf(title) && <option value="">Tipo…</option>}
                      {board.kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <details className="group rounded-lg border border-slate-200 dark:border-slate-700">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium select-none">
            <ChevronRight size={16} className="transition-transform group-open:rotate-90" />
            Campos extra
            <span className="text-xs font-normal text-slate-500">{extras ? `(${extras})` : "(opcional, para todas)"}</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-3 dark:border-slate-700">
            <div className="min-w-0">
              <label className="label truncate" htmlFor="bt-assignee">Asignada a (opcional)</label>
              <select id="bt-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Sin asignar</option>
                {board.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? `${u.name} (yo)` : u.name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className="label truncate" htmlFor="bt-due">Fecha límite (opcional)</label>
              <input id="bt-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="bt-deliverable">Entregable (opcional)</label>
              <select id="bt-deliverable" className="input" value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}>
                <option value="">Sin entregable</option>
                {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {board.labels.length > 0 && (
              <div className="col-span-2">
                <div className="label">Etiquetas (opcional)</div>
                <div className="flex flex-wrap gap-1.5">
                  {board.labels.map((l) => {
                    const on = labelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setLabelIds((ids) => (on ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
                        className={cn("rounded px-2 py-0.5 text-xs font-medium", on ? "text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                        style={on ? { backgroundColor: l.color } : undefined}
                        aria-pressed={on}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </details>
      </form>
    </Modal>
  );
}
