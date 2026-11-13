"use client";

import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { AlignLeft, Loader2, CalendarClock, Check, CheckSquare, ExternalLink, FileText, GripVertical, Hourglass, Image as ImageIcon, Lock, MessageSquare, Paperclip, Repeat } from "lucide-react";
import { blockerIsDone } from "@/lib/blocked";
import { mentionsToPlain } from "@/lib/mentions";
import { nextOccurrenceDue } from "@/lib/recurrence-date";
import { DEFAULT_WAITING_DAYS, isWhite, MAX_TITLE } from "@/lib/constants";
import { formatEuro, PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/task-fields";
import { daysBetween, dueStatus, formatDay, isoInZone } from "@/lib/dates";
import { appTimeZone } from "@/lib/format";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { BoardTask } from "@/lib/types";
import { useIntlLocale, useT } from "@/i18n/client";
import { Avatar } from "../ui/Avatar";
import { MentionText } from "../ui/MentionText";
import { cn } from "../ui/cn";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard, useIsSelected, useTask } from "./context";
import { useCardFileDrop } from "./useCardFileDrop";
import { useNearCard } from "./nearCards";
import { DueDatePopover } from "./DueDatePopover";
import { recurrenceLabel } from "./recurrence-ui";
import { overTitleLimit, TITLE_INPUT_LIMIT } from "./TitleLimit";
import { titleLength } from "@/lib/title-clamp";
import { focusCard, isTypingTarget } from "./shortcuts";
import { TaskViewerBubbles } from "./TaskViewerBubbles";

type Listeners = NonNullable<DraggableSyntheticListeners>;

/**
 * Tarjeta del tablero en su lista ordenable. Solo se apunta al arrastre (useSortable, en `SortableBinding`) cuando está a
 * la vista de su columna o cerca (ver nearCards.ts): con cientos de tarjetas, el arrastre redibujaba y medía todas en
 * cada cambio. El nodo y su contenido son los mismos se apunte o no (nada se vuelve a montar ni pierde el foco).
 */
export const SortableTaskCard = memo(function SortableTaskCard({ id }: { id: string }) {
  const { dragHandle } = useBoard();
  const t = useT();
  const task = useTask(id);
  const [near, nearRef, bindNow] = useNearCard(id);
  const node = useRef<HTMLDivElement | null>(null);
  const handle = useRef<HTMLButtonElement | null>(null);
  // Los manejadores de los sensores (pulsar con el puntero, teclas) los da useSortable; aquí se llaman los últimos. Si la
  // tarjeta aún no está apuntada (acaba de entrar en la vista), se apunta en el acto y el arrastre empieza igual.
  const listeners = useRef<Listeners | null>(null);
  const [relay] = useState<Listeners>(() => {
    const call = (name: "onPointerDown" | "onKeyDown", e: React.SyntheticEvent) => {
      if (!listeners.current) bindNow();
      listeners.current?.[name]?.(e);
    };
    return { onPointerDown: (e: React.PointerEvent) => call("onPointerDown", e), onKeyDown: (e: React.KeyboardEvent) => call("onKeyDown", e) };
  });
  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      node.current = el;
      return nearRef(el);
    },
    [nearRef],
  );
  if (!task) return null;
  // En táctil solo arrastra el asa: el resto de la tarjeta deja hacer scroll y abrirla con un toque.
  return (
    <>
      <div
        ref={setNode}
        // `data-dragging`: la tarjeta que se arrastra (su sitio queda atenuado mientras el overlay va con el puntero).
        className="relative touch-manipulation data-dragging:opacity-40"
        // Sin `attributes`: el contenedor no es enfocable (el Tab va directo a la tarjeta) y el arrastre por teclado
        // se sustituye por Alt+flechas en la tarjeta. Con ratón arrastra con los manejadores del sensor.
        {...(dragHandle ? {} : relay)}
      >
        <TaskViewerBubbles taskId={id} />
        <TaskCard
          task={task}
          lazy={!near}
          handle={dragHandle ? (
            <button
              type="button"
              ref={handle}
              {...relay}
              onClick={(e) => e.stopPropagation()}
              className="-my-1 -mr-1.5 flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-400 active:text-brand-600"
              aria-label={t("Arrastrar para reordenar")}
              // Solo para el dedo: con teclado se mueve con Alt+flechas sobre la propia tarjeta (que anuncia esos atajos).
              // Fuera del Tab y del árbol accesible: un botón dentro de la tarjeta (role=button) no se puede anunciar aparte.
              tabIndex={-1}
              aria-hidden
            >
              <GripVertical size={16} />
            </button>
          ) : null}
        />
      </div>
      {/* Detrás del nodo y no dentro: React fija los refs de un elemento después de los efectos de sus hijos, así que dentro,
          al montarse los dos a la vez (la tarjeta que se arrastra al pasar a otra columna), el nodo aún no estaría. */}
      {near && <SortableBinding id={id} nodeRef={node} handleRef={handle} listenersRef={listeners} withHandle={dragHandle} />}
    </>
  );
});

/**
 * Apunta la tarjeta al arrastre mientras está montado: useSortable sobre el nodo de la tarjeta. No pinta nada; el
 * desplazamiento (transform), la transición y el estado «arrastrándose» se ponen directamente en el nodo antes de pintar.
 * Desplazamiento en 2D y solo si lo hay: `translate3d` en todas las tarjetas de la columna (también con 0, 0) creaba una
 * capa de composición por tarjeta y repartirlas costaba más que el propio arrastre.
 */
function SortableBinding({ id, nodeRef, handleRef, listenersRef, withHandle }: {
  id: string;
  nodeRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<HTMLButtonElement | null>;
  listenersRef: RefObject<Listeners | null>;
  withHandle: boolean;
}) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  // Lo último que se puso en el nodo (al montar, nada: así lo deja también el desmontaje).
  const appliedRef = useRef({ move: "", transition: "", dragging: false });
  useLayoutEffect(() => {
    setNodeRef(nodeRef.current);
    setActivatorNodeRef(withHandle ? handleRef.current : null);
  }, [setNodeRef, setActivatorNodeRef, nodeRef, handleRef, withHandle]);
  useLayoutEffect(() => {
    listenersRef.current = listeners ?? null;
    const el = nodeRef.current;
    if (!el) return;
    const x = Math.round(transform?.x ?? 0);
    const y = Math.round(transform?.y ?? 0);
    const move = x || y ? `translate(${x}px, ${y}px)` : "";
    // Solo si cambia: cada escritura invalida el estilo de la tarjeta, y esto se ejecuta en cada paso del arrastre.
    const last = appliedRef.current;
    if (last.move !== move) el.style.transform = last.move = move;
    if (last.transition !== (transition ?? "")) el.style.transition = last.transition = transition ?? "";
    if (last.dragging !== isDragging) el.toggleAttribute("data-dragging", (last.dragging = isDragging));
  });
  useLayoutEffect(
    () => () => {
      listenersRef.current = null;
      setNodeRef(null);
      setActivatorNodeRef(null);
      appliedRef.current = { move: "", transition: "", dragging: false };
      const el = nodeRef.current;
      if (!el) return;
      el.style.transform = "";
      el.style.transition = "";
      el.removeAttribute("data-dragging");
    },
    [nodeRef, listenersRef, setNodeRef, setActivatorNodeRef, appliedRef],
  );
  return null;
}

/** Atajos de la tarjeta enfocada que se anuncian (aria-keyshortcuts): abrir, seleccionar, renombrar, mover, asignarme, fecha y duplicar. */
const CARD_SHORTCUTS = "Enter Space F2 Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+M Alt+D Alt+Shift+D";

export const TaskCard = memo(function TaskCard({ task, overlay = false, lazy = false, handle = null }: {
  task: BoardTask;
  overlay?: boolean;
  /** Lejos de la vista (ni apuntada al arrastre ni cerca): el navegador puede saltarse su contenido mientras no se vea. */
  lazy?: boolean;
  handle?: React.ReactNode;
}) {
  const { project, users, labels, openTask, toggleSelected, columns, today, kindById, cardStyle, assignToMe, moveToAdjacentColumn, moveWithinColumn, setDueDate, renameTask, duplicateTask } = useBoard();
  const locale = useIntlLocale();
  const t = useT();
  const column = columns.find((c) => c.id === task.columnId);
  const done = column?.isDone ?? false;
  // «Bloqueada por»: el aviso se apaga cuando la tarea que bloquea termina (columna terminada) o se archiva (ya no está en el tablero).
  const blocker = useTask(task.blockedBy?.id ?? "");
  const blockedBy = task.blockedBy && !blockerIsDone(blocker, columns) ? mentionsToPlain(blocker?.title ?? task.blockedBy.title) : null;
  // Columna «Esperando»: días naturales desde que la tarjeta entró (se resalta al llegar al plazo del recordatorio).
  const waitingDays = column?.role === "WAITING" ? Math.max(0, daysBetween(isoInZone(new Date(task.columnEnteredAt), appTimeZone()), today)) : null;
  const waitingLate = waitingDays !== null && waitingDays >= (column?.waitingDays ?? DEFAULT_WAITING_DAYS);
  // Columna «Rutinas»: fecha de la siguiente aparición (la misma regla que aplica el servidor al terminar la tarea).
  const nextRoutine = column?.role === "ROUTINES" && task.recurrence !== "NONE" ? nextOccurrenceDue(task.recurrence, task.recurrenceDay, task.dueDate, today) : null;
  const due = dueStatus(task.dueDate, done, today);
  const assignee = task.assigneeId ? users.find((u) => u.id === task.assigneeId) : null;
  const isSelected = useIsSelected(task.id);
  const filled = cardStyle === "FILLED" && !!task.color;
  const white = isWhite(task.color);
  const taskLabels = task.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => !!l);
  const repeat = recurrenceLabel(task, t, locale);
  // Campos opcionales del proyecto: insignias de prioridad y coste (si hay valor).
  const showPriority = project.taskFields.includes("priority") && task.priority;
  const showCost = project.taskFields.includes("cost") && task.cost !== null;

  // Nombre accesible = el título; el resto (tipo, fecha, responsable…) va en la descripción, que lee el lector de pantalla
  // después. Antes el nombre era todo el texto de la tarjeta, botones incluidos («Seleccionar … Arrastrar para reordenar…»).
  const descId = useId();
  const kind = kindById.get(task.kindId);
  const description = [
    ...taskLabels.map((l) => l.name),
    kind?.name,
    showPriority ? t("Prioridad: {p}", { p: t(PRIORITY_LABEL[task.priority!]) }) : null,
    showCost ? `${formatEuro(task.cost, locale)} (${task.costPaid ? t("Coste (pagado)") : t("Coste (pendiente de pago)")})` : null,
    task.dueDate ? `${due === "overdue" ? t("Plazo vencido") : t("Fecha límite")}: ${due === "today" ? t("Hoy") : formatDay(task.dueDate, today, locale)}` : null,
    blockedBy !== null ? t("Bloqueada por: {title}", { title: blockedBy }) : null,
    waitingDays !== null ? t("Esperando {n} d", { n: waitingDays }) : null,
    nextRoutine ? t("Próxima: {date}", { date: formatDay(nextRoutine, today, locale) }) : null,
    repeat,
    task.hasDescription ? t("Con descripción") : null,
    task.subtaskTotal > 0 ? t("Subtareas: {done} de {total}", { done: task.subtaskDone, total: task.subtaskTotal }) : null,
    task.commentCount > 0 ? (task.commentCount === 1 ? t("1 comentario") : t("{n} comentarios", { n: task.commentCount })) : null,
    task.linkCount > 0 ? `${t("Documentos de Google")}: ${task.linkCount}` : null,
    task.imageCount > 0 ? (task.imageCount === 1 ? t("1 imagen") : t("{n} imágenes", { n: task.imageCount })) : null,
    task.fileCount > 0 ? (task.fileCount === 1 ? t("1 archivo") : t("{n} archivos", { n: task.fileCount })) : null,
    task.linkUrl ? t("Enlace externo") : null,
    assignee ? t("Asignada a {name}", { name: assignee.name }) : null,
  ].filter(Boolean).join(". ");

  // F2: renombrar en la propia tarjeta. Alt+D: fecha límite en un pequeño selector (junto a la tarjeta).
  const [renaming, setRenaming] = useState(false);
  const [dueAnchor, setDueAnchor] = useState<HTMLElement | null>(null);
  // Soltar archivos sobre la tarjeta (escritorio) los adjunta a la tarea.
  const fileDrop = useCardFileDrop(task.id, !overlay);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      // Evita que el KeyboardSensor de dnd-kit empiece además un arrastre.
      e.stopPropagation();
      // Enter sobre el checkbox o el enlace internos solo los activa a ellos, no abre la tarea.
      if (e.target === e.currentTarget) openTask(task.id);
      return;
    }
    // Espacio en la tarjeta (no en el checkbox ni en el enlace): alterna su selección.
    if (e.key === " " && !overlay && e.target === e.currentTarget && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggleSelected(task.id);
      return;
    }
    // Atajos de la tarjeta enfocada (escritorio); no mientras se escribe (renombrar, fecha) ni con Ctrl/⌘.
    if (overlay || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || isTypingTarget(e.target)) return;
    // `e.code` con Alt: en Mac Option+letra produce otro carácter.
    if (e.code === "F2" && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      setRenaming(true);
      return;
    }
    if (!e.altKey || e.repeat) return;
    if (e.shiftKey) {
      if (e.code !== "KeyD") return;
      e.preventDefault();
      void duplicateTask(task.id);
      return;
    }
    if (e.code === "KeyM") void assignToMe(task.id);
    else if (e.code === "ArrowLeft") void moveToAdjacentColumn(task.id, -1);
    else if (e.code === "ArrowRight") void moveToAdjacentColumn(task.id, 1);
    else if (e.code === "ArrowUp") void moveWithinColumn(task.id, -1);
    else if (e.code === "ArrowDown") void moveWithinColumn(task.id, 1);
    else if (e.code === "KeyD") setDueAnchor(e.currentTarget);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-task-card={task.id}
      aria-label={mentionsToPlain(task.title)}
      aria-describedby={overlay ? undefined : descId}
      // Selección múltiple (Espacio): botón que se queda pulsado mientras está seleccionada.
      aria-pressed={overlay ? undefined : isSelected}
      aria-keyshortcuts={overlay ? undefined : CARD_SHORTCUTS}
      onClick={() => openTask(task.id)}
      onKeyDown={onKeyDown}
      {...(overlay ? {} : fileDrop.handlers)}
      className={cn(
        fileDrop.over && "border-focus ring-2 ring-focus/50",
        "group relative cursor-pointer overflow-hidden rounded-lg border bg-white p-2.5 pl-3 text-left shadow-sm transition-shadow select-none hover:shadow-md dark:bg-slate-900",
        // Lejos de la vista, el navegador no calcula ni pinta su contenido (sigue en la página: foco, lector de pantalla y
        // buscar del navegador). Con cientos de tarjetas, cada fotograma del arrastre y cada pulsación del buscador repasaba
        // todas. El alto de una que aún no se ha visto es aproximado (5 rem) hasta que aparece; después se recuerda el real.
        // Nunca en las apuntadas al arrastre (las cercanas y la que se arrastra): dnd-kit las mide, y una recién montada
        // mediría el alto aproximado. En la tarjeta y no en su envoltorio: la contención recorta lo que sobresale, y la
        // tarjeta ya lo recorta (overflow-hidden); su anillo de foco y su sombra, que van por fuera, no se recortan.
        lazy && "[contain-intrinsic-size:auto_5rem] [content-visibility:auto]",
        isSelected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-slate-700/80",
        overlay && "rotate-2 shadow-xl",
        // Blanco: sin tinte posible, se distingue con fondo/borde propios.
        filled && white && "bg-white dark:bg-white/15",
        filled && white && !isSelected && "border-slate-400 dark:border-white/50",
      )}
      // Estilo «tarjeta entera»: fondo teñido suave (legible en claro y oscuro) y borde del color.
      style={filled && white ? undefined : filled && !isSelected ? { backgroundColor: `${task.color}26`, borderColor: `${task.color}80` } : filled ? { backgroundColor: `${task.color}26` } : undefined}
    >
      {(fileDrop.over || fileDrop.uploading > 0) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5 bg-white/95 text-sm font-semibold text-brand-700 dark:bg-slate-900/95 dark:text-brand-300" role="status">
          {fileDrop.over ? t("Suelta para adjuntar") : (<><Loader2 size={15} className="animate-spin" /> {t("Subiendo…")}</>)}
        </div>
      )}
      {!overlay && <span id={descId} hidden>{description}</span>}
      {task.color && !filled && <span className="absolute inset-y-0 left-0 w-1 ring-1 ring-inset ring-black/10 dark:ring-white/25" style={{ backgroundColor: task.color }} aria-hidden />}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelected(task.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          // Fuera del Tab (se alterna con Espacio sobre la tarjeta); sigue siendo pulsable con ratón y táctil.
          tabIndex={-1}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-opacity",
            isSelected
              ? "border-brand-600 bg-brand-600 text-on-brand"
              : "border-slate-300 opacity-60 group-hover:opacity-100 max-md:opacity-100 dark:border-slate-600",
          )}
          aria-label={isSelected ? t("Quitar de la selección") : t("Seleccionar")}
          // Para el lector de pantalla la selección la expone la tarjeta (aria-pressed) y se alterna con Espacio.
          aria-hidden
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </button>
        {renaming ? (
          <RenameInput
            title={task.title}
            onDone={async (value, save, refocus) => {
              setRenaming(false);
              if (refocus) focusCard(task.id);
              if (save) await renameTask(task.id, value);
            }}
          />
        ) : (
          <p className="min-w-0 flex-1 text-sm leading-snug font-medium break-words"><MentionText text={task.title} /></p>
        )}
        {handle}
      </div>

      {taskLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {taskLabels.map((l) => (
            <span key={l.id} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", isWhite(l.color) ? "text-slate-800 ring-1 ring-inset ring-slate-300" : "text-white")} style={{ backgroundColor: l.color }}>
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <TypeBadge kind={kindById.get(task.kindId)} />
        {showPriority && (
          <span
            className="rounded px-1.5 py-px text-[10px] font-semibold text-white"
            style={{ backgroundColor: PRIORITY_COLOR[task.priority!] }}
            title={t("Prioridad: {p}", { p: t(PRIORITY_LABEL[task.priority!]) })}
          >
            {t(PRIORITY_LABEL[task.priority!])}
          </span>
        )}
        {showCost && (
          <span
            className={cn("inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200", task.costPaid && "text-emerald-700 dark:text-emerald-300")}
            title={task.costPaid ? t("Coste (pagado)") : t("Coste (pendiente de pago)")}
          >
            {formatEuro(task.cost, locale)}{task.costPaid && <Check size={11} strokeWidth={3} aria-hidden />}
          </span>
        )}
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 font-medium",
              due === "overdue" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
              (due === "today" || due === "soon") && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
              due === "done" && "text-emerald-600",
            )}
            title={due === "overdue" ? t("Plazo vencido") : t("Fecha límite")}
          >
            <CalendarClock size={12} /> {due === "today" ? t("Hoy") : formatDay(task.dueDate, today, locale)}
          </span>
        )}
        {blockedBy !== null && (
          <span
            className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            title={t("Bloqueada por: {title}", { title: blockedBy })}
            data-blocked
          >
            <Lock size={12} aria-hidden /><span className="sr-only">{t("Bloqueada por: {title}", { title: blockedBy })}</span>
          </span>
        )}
        {waitingDays !== null && (
          <span
            className={cn("inline-flex items-center gap-0.5 rounded px-1 font-medium", waitingLate && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300")}
            title={t("Lleva {n} d en esta columna", { n: waitingDays })}
          >
            <Hourglass size={12} /> {t("Esperando {n} d", { n: waitingDays })}
          </span>
        )}
        {nextRoutine && (
          <span className="inline-flex items-center gap-0.5 rounded px-1 font-medium text-brand-700 dark:text-brand-300" title={t("Fecha de la siguiente aparición")}>
            <Repeat size={12} /> {t("Próxima: {date}", { date: formatDay(nextRoutine, today, locale) })}
          </span>
        )}
        {repeat && <span title={repeat} className="inline-flex"><Repeat size={13} aria-label={repeat} /></span>}
        {task.hasDescription && <AlignLeft size={13} aria-label={t("Con descripción")} />}
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
          <span className="inline-flex items-center gap-0.5" title={t("Documentos de Google")}>
            <FileText size={13} /> {task.linkCount}
          </span>
        )}
        {task.imageCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title={task.imageCount === 1 ? t("1 imagen") : t("{n} imágenes", { n: task.imageCount })}>
            <ImageIcon size={13} /> {task.imageCount}
          </span>
        )}
        {task.fileCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title={task.fileCount === 1 ? t("1 archivo") : t("{n} archivos", { n: task.fileCount })}>
            <Paperclip size={13} /> {task.fileCount}
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
            aria-label={t("Abrir enlace externo")}
            // Atajo para el ratón: con teclado o lector de pantalla, el enlace está en el detalle (la tarjeta lo menciona).
            tabIndex={-1}
            aria-hidden
          >
            <ExternalLink size={13} />
          </a>
        )}
        <span className="ml-auto">{assignee && <Avatar id={assignee.id} name={assignee.name} title={t("Asignada a {name}", { name: assignee.name })} />}</span>
      </div>
      {dueAnchor && (
        <DueDatePopover
          anchor={dueAnchor}
          value={task.dueDate}
          today={today}
          onClose={() => {
            setDueAnchor(null);
            focusCard(task.id);
          }}
          onPick={(day) => {
            setDueAnchor(null);
            focusCard(task.id);
            void setDueDate(task.id, day);
          }}
        />
      )}
    </div>
  );
});

/** Título editable en la tarjeta: Enter guarda, Esc cancela y al salir del campo también se guarda. */
function RenameInput({ title, onDone }: { title: string; onDone: (value: string, save: boolean, refocus: boolean) => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(title);
  const over = overTitleLimit(value);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean, refocus: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value, save, refocus);
  };
  return (
    <input
      ref={ref}
      value={value}
      maxLength={TITLE_INPUT_LIMIT}
      aria-label={t("Título")}
      aria-invalid={over || undefined}
      title={over ? `${titleLength(value)}/${MAX_TITLE}` : undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true, false)}
      onClick={(e) => e.stopPropagation()}
      // Sin esto, pulsar y mover dentro del campo arrastraría la tarjeta.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Las teclas del campo no deben llegar a la tarjeta (atajos) ni al arrastre por teclado.
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false, true);
        }
      }}
      className={cn("min-w-0 flex-1 rounded border bg-white px-1 text-sm leading-snug font-medium outline-none dark:bg-slate-900", over ? "border-red-500 text-red-700 dark:text-red-300" : "border-brand-500")}
    />
  );
}
