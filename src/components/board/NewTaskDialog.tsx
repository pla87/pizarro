"use client";

import { Camera, File as FileIcon, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createTask } from "@/actions/tasks";
import { useT, useIntlLocale } from "@/i18n/client";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { useShortcut } from "./shortcuts";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { DescriptionField } from "../ui/DescriptionField";
import { applyKindTemplate } from "@/lib/kinds-special";
import { TypeSelector } from "./TaskDialog";
import type { T } from "@/i18n/core";
import { filesFrom, isImageFile, uploadFile, useFileDrop } from "./upload";
import { draftKey, useDraftAutosave, type NewTaskDraft } from "./drafts";

interface Props {
  initialColumnId?: string;
  /** Crear la tarea como fija en la release (solo si la columna es la de la release). */
  initialEvergreen?: boolean;
  initialFiles?: File[];
  onClose: () => void;
  /** Escritorio: posición en pantalla cuando hay dos modales a la vez. */
  side?: "left" | "right" | "center";
  /** Escritorio: muestra el «+» para abrir un segundo modal de nueva tarea al lado. */
  onAddSecond?: () => void;
  /** Borrador recuperado (la página se cerró con el modal abierto). */
  draft?: NewTaskDraft | null;
  /** Guarda un borrador local cada 5 s (solo el modal principal). */
  autosave?: boolean;
}

function captureTitle(t: T, locale: string): string {
  return t("Captura") + " " + new Date().toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

export function NewTaskDialog({ initialColumnId, initialEvergreen, initialFiles, onClose: close, side, onAddSecond, draft, autosave = false }: Props) {
  const t = useT();
  const sc = useShortcut();
  const locale = useIntlLocale();
  const uid = useId();
  const formId = `${uid}-new-task`;
  const board = useBoard();
  const toast = useToast();
  // Un borrador solo vale si su tipo y su columna siguen existiendo.
  const d = draft ?? null;
  const [title, setTitle] = useState(() => d?.title ?? (initialFiles?.length ? captureTitle(t, locale) : ""));
  const [kindId, setKindId] = useState(d && board.kindById.has(d.kindId) ? d.kindId : (board.kinds[0]?.id ?? ""));
  const [columnId, setColumnId] = useState(d && board.columns.some((c) => c.id === d.columnId) ? d.columnId : (initialColumnId ?? board.columns[0]?.id ?? ""));
  const [assigneeId, setAssigneeId] = useState(d?.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(d?.dueDate ?? "");
  const [deliverableId, setDeliverableId] = useState(d?.deliverableId ?? "");
  const [description, setDescription] = useState(d?.description ?? "");
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [subtasks, setSubtasks] = useState<string[]>(d?.subtasks ?? []);
  const [subtaskDraft, setSubtaskDraft] = useState(d?.subtaskDraft ?? "");
  const [evergreen, setEvergreen] = useState(d?.evergreen ?? !!initialEvergreen);
  // Borrador cada 5 s; cancelar o crear lo borra (los archivos no se guardan en el borrador).
  const discardDraft = useDraftAutosave(draftKey("new", board.currentUserId, board.project.id), () =>
    !autosave
      ? undefined
      : !title.trim() && !description.trim() && !subtasks.length && !subtaskDraft.trim()
        ? null
        : ({ title, kindId, description, columnId, assigneeId, dueDate, deliverableId, evergreen, subtasks, subtaskDraft } satisfies NewTaskDraft),
  );
  const onClose = () => {
    if (autosave) discardDraft();
    close();
  };
  const isReleaseColumn = board.columns.find((c) => c.id === columnId)?.role === "NEXT_RELEASE";
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const imageIndexes = files.flatMap((f, i) => (isImageFile(f) ? [i] : []));

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    setFiles((prev) => [...prev, ...list].slice(0, 10));
    // Con una captura y sin título, se propone uno para ir más rápido.
    setTitle((cur) => cur || captureTitle(t, locale));
  };

  const dropping = useFileDrop(addFiles);

  const addSubtaskDraft = () => {
    const text = subtaskDraft.trim();
    if (!text) return;
    setSubtasks((l) => (l.length >= 50 ? l : [...l, text.slice(0, 200)]));
    setSubtaskDraft("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !title.trim() || !columnId) return;
    setBusy(true);
    // Una subtarea a medio escribir también se guarda al crear.
    const pending = subtaskDraft.trim().slice(0, 200);
    const subtaskTitles = pending && subtasks.length < 50 ? [...subtasks, pending] : subtasks;
    const res = await board.track(
      createTask({
        projectId: board.project.id, columnId, title, kindId, description,
        assigneeId: assigneeId || null, dueDate: dueDate || null, deliverableId: deliverableId || null,
        evergreen: isReleaseColumn && evergreen,
        subtasks: subtaskTitles,
      }),
    ).catch(() => ({ ok: false as const, error: t("Error inesperado. Inténtalo de nuevo.") }));
    if (!res.ok) {
      setBusy(false);
      return toast(res.error, "error");
    }
    let task = res.data;
    board.upsertTask(task);
    // Los archivos se suben en paralelo tras crear la tarea.
    const results = await Promise.allSettled(files.map((f) => board.trackRaw(uploadFile(task.id, f, true, t))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (ok) {
      task = { ...task, attachmentCount: task.attachmentCount + ok };
      board.upsertTask(task);
    }
    if (failed) toast((failed.reason as Error).message, "error");
    else toast(t("Tarea creada"));
    onClose();
  };

  // Alt+S crea la tarea (también escribiendo), como Ctrl+Enter. Con dos modales a la vez, el que tiene el foco.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== "KeyS" || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
      const mine = formRef.current?.closest("[role=dialog]");
      const other = (e.target as HTMLElement | null)?.closest?.("[role=dialog]");
      if (other ? other !== mine : side === "right") return;
      e.preventDefault();
      formRef.current?.requestSubmit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [side]);

  return (
    <Modal
      open
      onClose={onClose}
      side={side}
      onAddSecond={onAddSecond}
      title={t("Nueva tarea")}
      size="md"
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button type="submit" form={formId} className="btn-primary" disabled={busy || !title.trim()} title={`${t("Crear tarea")} (${sc("Alt+S")})`}>
            {busy && <Loader2 size={16} className="animate-spin" />} {t("Crear tarea")}
          </button>
        </>
      }
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="space-y-3" onKeyDown={(e) => {
        // Ctrl/Cmd+Enter en cualquier campo crea la tarea (como pulsar «Crear tarea»).
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }} onPaste={(e) => {
        const pasted = filesFrom(e.clipboardData.items);
        if (pasted.length) {
          e.preventDefault();
          addFiles(pasted);
        }
      }}>
        <div>
          <label className="label" htmlFor={`${uid}-title`}>{t("Título")}</label>
          <input id={`${uid}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required data-autofocus />
        </div>
        <div>
          <div className="label">{t("Tipo")}</div>
          <TypeSelector kinds={board.kinds} value={kindId} onChange={(id) => {
            setKindId(id);
            // Tipo especial «Respuesta»: título y primera línea de la descripción predefinidos.
            const kind = board.kindById.get(id);
            const preset = kind ? applyKindTemplate(kind, { title, description }) : null;
            if (preset) {
              setTitle(preset.title);
              setDescription(preset.description);
            }
          }} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-desc`}>{t("Descripción (opcional)")}</label>
          <DescriptionField id={`${uid}-desc`} mode={board.editorMode} textareaClassName="input field-sizing-content min-h-14" value={description} onValueChange={setDescription} users={board.users} maxLength={20000} placeholder={t("Markdown · @persona para avisar")} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-subtask`}>{t("Subtareas (opcional)")}</label>
          {subtasks.length > 0 && (
            <ul className="mb-1.5 space-y-0.5">
              {subtasks.map((s, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-slate-50 py-0.5 pr-0.5 pl-2 text-sm dark:bg-slate-800/50">
                  <span className="min-w-0 flex-1 break-words">{s}</span>
                  <button type="button" className="btn-icon h-6 w-6 shrink-0" onClick={() => setSubtasks((l) => l.filter((_, j) => j !== i))} aria-label={t("Quitar subtarea")}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id={`${uid}-subtask`}
              className="input py-1.5"
              placeholder={t("Añadir subtarea…")}
              value={subtaskDraft}
              maxLength={200}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter añade la subtarea sin enviar el formulario; Ctrl/Cmd+Enter sigue creando la tarea.
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addSubtaskDraft();
                }
              }}
            />
            <button type="button" className="btn-secondary py-1.5" disabled={!subtaskDraft.trim() || subtasks.length >= 50} onClick={addSubtaskDraft} aria-label={t("Añadir subtarea")}>
              <Plus size={15} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <div className="min-w-0">
            <label className="label" htmlFor={`${uid}-column`}>{t("Columna")}</label>
            <select id={`${uid}-column`} className="input" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-deliverable`}>{t("Entregable (opcional)")}</label>
            <select id={`${uid}-deliverable`} className="input" value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">{t("Sin entregable")}</option>
              {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-assignee`}>{t("Asignada a (opcional)")}</label>
            <select id={`${uid}-assignee`} className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t("Sin asignar")}</option>
              {board.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? t("{name} (yo)", { name: u.name }) : u.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-due`}>{t("Fecha límite (opcional)")}</label>
            <input id={`${uid}-due`} type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        {isReleaseColumn && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} />
            {t("Fija en la release (evergreen)")}
          </label>
        )}
        <div>
          <div className="label">{t("Capturas y adjuntos")}</div>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${previews[i]}`} className="relative">
                {isImageFile(f) ? (
                  <button type="button" className="block" onClick={() => setLightbox(imageIndexes.indexOf(i))} aria-label={t("Ver imagen")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[i]} alt="" className="h-14 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
                  </button>
                ) : (
                  <div className="flex h-14 max-w-40 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs dark:border-slate-700 dark:bg-slate-800" title={f.name}>
                    <FileIcon size={16} className="shrink-0 text-slate-500" />
                    <span className="line-clamp-2 break-all">{f.name}</span>
                  </div>
                )}
                <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-900 p-0.5 text-white" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label={t("Quitar archivo")}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 dark:border-slate-700">
              <ImagePlus size={16} /> {t("Archivo")}
              <input type="file" multiple className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 sm:hidden dark:border-slate-700">
              <Camera size={16} /> {t("Cámara")}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <p className="self-center text-xs text-slate-500 max-sm:hidden">{t("o pega o arrastra archivos (máx. 10 MB)")}</p>
          </div>
        </div>
      </form>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-brand-500/15 p-4 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-lg font-semibold text-brand-700 shadow-xl dark:bg-slate-900/90 dark:text-brand-300">
            {t("Suelta para adjuntar")}
          </div>
        </div>
      )}
      {lightbox !== null && imageIndexes.length > 0 && (
        <Lightbox
          images={imageIndexes.map((i) => ({ src: previews[i]!, alt: files[i]?.name }))}
          index={Math.min(lightbox, imageIndexes.length - 1)}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </Modal>
  );
}
