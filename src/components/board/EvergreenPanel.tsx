"use client";

import { useDndContext, useDroppable } from "@dnd-kit/core";
import { ChevronUp, Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "../ui/cn";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";

/** Prefijo del id del droppable del panel (el resto es el id de la columna de la release). */
export const EVERGREEN_DROPPABLE_PREFIX = "evergreen:";
/** Tiempo con una tarjeta encima de la barra plegada antes de que se abra sola. */
const SPRING_OPEN_MS = 300;

/** Clave de localStorage del estado plegado/desplegado, por proyecto. */
const storageKey = (projectId: string) => `pizarro:evergreen-open:${projectId}`;

const listeners = new Set<() => void>();
/** Respaldo en memoria si localStorage no está disponible. */
const memory = new Map<string, boolean>();

/**
 * Panel al pie de la columna de la release con las tareas «siempre en la release» (evergreen).
 * Plegado es una barra con el contador; desplegado crece hacia arriba mostrando tarjetas compactas.
 */
export function EvergreenPanel({ columnId, taskIds }: { columnId: string; taskIds: string[] }) {
  const { project, taskById, kindById, openTask, openNewTask } = useBoard();
  // Estado en localStorage leído como store externo (en servidor, plegado).
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(storageKey(project.id)) === "1";
      } catch {
        return memory.get(project.id) ?? false;
      }
    },
    () => false,
  );

  // Arrastrar una tarjeta sobre el panel: se suelta aquí para hacerla fija y, tras una pausa, se abre solo
  // (como una carpeta con resorte). La apertura es temporal: se pliega al terminar el arrastre.
  const { setNodeRef, isOver } = useDroppable({ id: EVERGREEN_DROPPABLE_PREFIX + columnId });
  const dragging = useDndContext().active !== null;
  const [sprung, setSprung] = useState(false);
  const open = stored || (sprung && dragging);
  const hovering = isOver && dragging;
  useEffect(() => {
    if (!dragging) return;
    return () => setSprung(false); // al terminar el arrastre vuelve a plegarse
  }, [dragging]);
  useEffect(() => {
    if (!hovering || open) return;
    const timer = setTimeout(() => setSprung(true), SPRING_OPEN_MS);
    return () => clearTimeout(timer);
  }, [hovering, open]);

  const toggle = () => {
    const next = !stored;
    memory.set(project.id, next);
    try {
      localStorage.setItem(storageKey(project.id), next ? "1" : "0");
    } catch {
      /* sin almacenamiento: solo dura la sesión */
    }
    listeners.forEach((cb) => cb());
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 rounded-b-xl border-t border-slate-200 transition-colors dark:border-slate-800",
        hovering && "bg-brand-50 ring-2 ring-brand-500 ring-inset dark:bg-brand-500/10",
      )}
    >
      {open && (
        <div id={`evergreen-${columnId}`} className="max-h-56 space-y-1.5 overflow-y-auto px-2 pt-2 max-lg:pr-16">
          {taskIds.map((id) => {
            const task = taskById.get(id);
            if (!task) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => openTask(id)}
                className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs shadow-sm hover:shadow-md dark:border-slate-700/80 dark:bg-slate-900"
              >
                <span className="min-w-0 flex-1 truncate font-medium" title={task.title}>{task.title}</span>
                <TypeBadge kind={kindById.get(task.kindId)} />
              </button>
            );
          })}
          {taskIds.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Sin tareas fijas</p>}
          <button
            type="button"
            onClick={() => openNewTask(columnId, true)}
            className="btn-ghost w-full justify-center py-1 text-xs"
          >
            <Plus size={13} /> Añadir
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`evergreen-${columnId}`}
        className="flex w-full items-center gap-1.5 rounded-b-xl px-3 py-2 max-lg:pr-20 text-xs font-medium text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/60"
      >
        <span>Siempre en la release</span>
        <span className="rounded-full bg-slate-200 px-1.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">{taskIds.length}</span>
        <ChevronUp size={14} className={cn("lg:ml-auto transition-transform", open && "rotate-180")} />
      </button>
    </div>
  );
}
