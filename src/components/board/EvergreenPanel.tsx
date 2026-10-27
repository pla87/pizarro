"use client";

import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronUp, GripVertical, Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard, useTask } from "./context";
import { useFileZone } from "./useFileZone";
import { MentionText } from "../ui/MentionText";
import { mentionsToPlain } from "@/lib/mentions";
import { nextEvergreenEvery } from "@/lib/release";

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
  const { project, openNewTask } = useBoard();
  const t = useT();
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

  // Archivos soltados sobre el panel: nueva tarea fija en esta columna.
  const fileZone = useFileZone((files) => openNewTask(columnId, true, files));

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
        (hovering || fileZone.over) && "bg-brand-50 ring-2 ring-brand-500 ring-inset dark:bg-brand-500/10",
      )}
      {...fileZone.handlers}
    >
      {open && (
        <div id={`evergreen-${columnId}`} className="-mb-1.5 max-h-56 space-y-1.5 overflow-y-auto px-2 pt-2 pb-1.5 max-lg:pr-16">
          {taskIds.map((id) => <EvergreenCard key={id} id={id} />)}
          {taskIds.length === 0 && <p className="py-2 text-center text-xs text-slate-400">{t("Sin tareas fijas")}</p>}
          <button
            type="button"
            onClick={() => openNewTask(columnId, true)}
            className="btn-ghost w-full justify-center py-1 text-xs"
          >
            <Plus size={13} /> {t("Añadir")}
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
        <span>{t("Siempre en la release")}</span>
        <span className="rounded-full bg-slate-200 px-1.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">{taskIds.length}</span>
        <ChevronUp size={14} className={cn("lg:ml-auto transition-transform", open && "rotate-180")} />
      </button>
    </div>
  );
}

/** Tarjeta compacta del panel: se puede arrastrar a cualquier columna (deja de ser fija al soltarla). */
function EvergreenCard({ id }: { id: string }) {
  const { kindById, openTask, dragHandle, setEvergreenEvery } = useBoard();
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id });
  const task = useTask(id);
  if (!task) return null;
  // En táctil solo arrastra el asa (igual que las tarjetas normales).
  const every = task.evergreenEvery;
  const everyLabel = every === 2 ? t("Cada dos") : every === 3 ? t("Cada tres") : t("En todas");
  const everyHint = every === 2 ? t("Incluir cada dos releases") : every === 3 ? t("Incluir cada tres releases") : t("Incluir en todas las releases");
  // div con rol de botón (y no <button>) porque lleva dentro el interruptor de cadencia.
  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      {...(dragHandle ? {} : { ...attributes, ...listeners })}
      onClick={() => openTask(id)}
      onKeyDown={(e) => {
        // Enter abre la tarea; evita que el KeyboardSensor empiece además un arrastre.
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.stopPropagation();
          openTask(id);
        }
      }}
      className={cn(
        "flex w-full cursor-pointer touch-manipulation items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs shadow-sm hover:shadow-md dark:border-slate-700/80 dark:bg-slate-900",
        isDragging && "opacity-40",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-medium" title={mentionsToPlain(task.title)}><MentionText text={task.title} /></span>
      {/* Cadencia: en todas / cada dos / cada tres releases. Mismo color que la barra de progreso de subtareas. */}
      <button
        type="button"
        aria-label={everyHint}
        title={everyHint}
        data-testid="evergreen-every"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void setEvergreenEvery(id, nextEvergreenEvery(every));
        }}
        className={cn(
          "inline-flex h-4 shrink-0 items-center gap-1 rounded-full border border-progress px-1.5 text-[10px] leading-none text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-progress dark:text-slate-300",
          every > 1 ? "bg-progress/20 font-semibold" : "bg-transparent opacity-70 hover:opacity-100",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-progress" aria-hidden />
        {everyLabel}
      </button>
      <TypeBadge kind={kindById.get(task.kindId)} />
      {dragHandle && (
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="-my-1 -mr-1 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-400 active:text-brand-600"
          aria-label={t("Arrastrar para reordenar")}
        >
          <GripVertical size={14} />
        </span>
      )}
    </div>
  );
}
