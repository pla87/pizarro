"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, CalendarClock, Check, CheckSquare, ExternalLink, FileText, Image as ImageIcon, MessageSquare } from "lucide-react";
import { dueStatus, formatDay } from "@/lib/dates";
import { memo } from "react";
import type { BoardTask } from "@/lib/types";
import { Avatar } from "../ui/Avatar";
import { cn } from "../ui/cn";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";

export function SortableTaskCard({ id }: { id: string }) {
  const { taskById } = useBoard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const task = taskById.get(id);
  if (!task) return null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} />
    </div>
  );
}

export const TaskCard = memo(function TaskCard({ task, overlay = false }: { task: BoardTask; overlay?: boolean }) {
  const { users, labels, openTask, selected, toggleSelected, columns, today, kindById, cardStyle } = useBoard();
  const done = columns.find((c) => c.id === task.columnId)?.isDone ?? false;
  const due = dueStatus(task.dueDate, done, today);
  const assignee = task.assigneeId ? users.find((u) => u.id === task.assigneeId) : null;
  const isSelected = selected.has(task.id);
  const filled = cardStyle === "FILLED" && !!task.color;
  const taskLabels = task.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => !!l);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // Evita que el KeyboardSensor de dnd-kit empiece además un arrastre.
          e.stopPropagation();
          openTask(task.id);
        }
      }}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-2.5 pl-3 text-left shadow-sm transition-shadow select-none hover:shadow-md dark:bg-slate-900",
        isSelected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-slate-700/80",
        overlay && "rotate-2 shadow-xl",
      )}
      // Estilo «tarjeta entera»: fondo teñido suave (legible en claro y oscuro) y borde del color.
      style={filled && !isSelected ? { backgroundColor: `${task.color}26`, borderColor: `${task.color}80` } : filled ? { backgroundColor: `${task.color}26` } : undefined}
    >
      {task.color && !filled && <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: task.color }} aria-hidden />}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelected(task.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-opacity",
            isSelected
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-300 opacity-60 group-hover:opacity-100 max-md:opacity-100 dark:border-slate-600",
          )}
          aria-label={isSelected ? "Quitar de la selección" : "Seleccionar"}
          aria-pressed={isSelected}
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </button>
        <p className="min-w-0 flex-1 text-sm leading-snug font-medium break-words">{task.title}</p>
      </div>

      {taskLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {taskLabels.map((l) => (
            <span key={l.id} className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: l.color }}>
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <TypeBadge kind={kindById.get(task.kindId)} />
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 font-medium",
              due === "overdue" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
              (due === "today" || due === "soon") && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
              due === "done" && "text-emerald-600",
            )}
            title={due === "overdue" ? "Plazo vencido" : "Fecha límite"}
          >
            <CalendarClock size={12} /> {due === "today" ? "Hoy" : formatDay(task.dueDate, today)}
          </span>
        )}
        {task.hasDescription && <AlignLeft size={13} aria-label="Con descripción" />}
        {task.subtaskTotal > 0 && (
          <span className={cn("inline-flex items-center gap-0.5", task.subtaskDone === task.subtaskTotal && "text-emerald-600")}>
            <CheckSquare size={13} /> {task.subtaskDone}/{task.subtaskTotal}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare size={13} /> {task.commentCount}
          </span>
        )}
        {task.linkCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title="Documentos de Google">
            <FileText size={13} /> {task.linkCount}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <ImageIcon size={13} /> {task.attachmentCount}
          </span>
        )}
        {task.linkUrl && (
          <a
            href={task.linkUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="hover:text-brand-600"
            aria-label="Abrir enlace externo"
          >
            <ExternalLink size={13} />
          </a>
        )}
        <span className="ml-auto">{assignee && <Avatar id={assignee.id} name={assignee.name} />}</span>
      </div>
    </div>
  );
});
