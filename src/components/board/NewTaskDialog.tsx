"use client";

import { Camera, File as FileIcon, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createTask, getProjectFormData } from "@/actions/tasks";
import { ProjectsContext } from "../ProjectMenu";
import { DescriptionTools } from "../ui/DescriptionTools";
import type { ProjectFormData } from "@/lib/types";
import { useT, useIntlLocale } from "@/i18n/client";
import { useConfirm } from "../ui/ConfirmDialog";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { useShortcut } from "./shortcuts";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { DescriptionField } from "../ui/DescriptionField";
import { applyKindTemplate, mergeSubtasks } from "@/lib/kinds-special";
import { TypeSelector } from "./TaskDialog";
import type { T } from "@/i18n/core";
import { AttachLimitHint } from "./AttachLimitHint";
import { attachmentPatch, filesFrom, isImageFile, uploadFile, useFileDrop } from "./upload";
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
  const confirm = useConfirm();
  const router = useRouter();
  const { projects } = useContext(ProjectsContext);
  // Un borrador solo vale si su tipo y su columna siguen existiendo.
  const d = draft ?? null;
  // Proyecto en el que se crea: por defecto el abierto; un borrador recuerda el elegido (si aún se puede usar).
  const initialProject = d?.projectId && d.projectId !== board.project.id && projects.some((p) => p.id === d.projectId) ? d.projectId : board.project.id;
  const foreignInit = initialProject !== board.project.id;
  const [projectId, setProjectId] = useState(initialProject);
  // Opciones del proyecto elegido cuando no es el abierto (se piden al servidor y se guardan mientras el diálogo siga abierto).
  const [other, setOther] = useState<ProjectFormData | null>(null);
  const formCache = useRef(new Map<string, ProjectFormData>());
  const wantedProject = useRef(initialProject);
  const boardForm = useMemo<ProjectFormData>(
    () => ({ project: board.project, columns: board.columns, users: board.users, kinds: board.kinds, deliverables: board.deliverables }),
    [board.project, board.columns, board.users, board.kinds, board.deliverables],
  );
  const pf = projectId === board.project.id ? boardForm : other?.project.id === projectId ? other : null;
  // Mientras llegan las opciones de otro proyecto se muestran las del abierto, sin poder crear.
  const loading = !pf;
  const form = pf ?? boardForm;
  const [title, setTitle] = useState(() => d?.title ?? (initialFiles?.length ? captureTitle(t, locale) : ""));
  const [kindId, setKindId] = useState(!foreignInit && d && board.kindById.has(d.kindId) ? d.kindId : foreignInit ? "" : (board.kinds[0]?.id ?? ""));
  const [columnId, setColumnId] = useState(!foreignInit && d && board.columns.some((c) => c.id === d.columnId) ? d.columnId : foreignInit ? "" : (initialColumnId ?? board.columns[0]?.id ?? ""));
  const [assigneeId, setAssigneeId] = useState(foreignInit ? "" : (d?.assigneeId ?? ""));
  const [dueDate, setDueDate] = useState(d?.dueDate ?? "");
  const [deliverableId, setDeliverableId] = useState(foreignInit ? "" : (d?.deliverableId ?? ""));
  const [description, setDescription] = useState(d?.description ?? "");
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [subtasks, setSubtasks] = useState<string[]>(d?.subtasks ?? []);
  const [subtaskDraft, setSubtaskDraft] = useState(d?.subtaskDraft ?? "");
  const [evergreen, setEvergreen] = useState(foreignInit ? false : (d?.evergreen ?? !!initialEvergreen));

  /** Ajusta las opciones al proyecto de `f`: conserva lo que siga existiendo en él y, si no, usa su primera columna / tipo. */
  const applyForm = (f: ProjectFormData, keep: { kindId: string; columnId: string; assigneeId: string; deliverableId: string }) => {
    setKindId(f.kinds.some((k) => k.id === keep.kindId) ? keep.kindId : (f.kinds[0]?.id ?? ""));
    setColumnId(f.columns.some((c) => c.id === keep.columnId) ? keep.columnId : f.project.id === board.project.id ? (initialColumnId ?? f.columns[0]?.id ?? "") : (f.columns[0]?.id ?? ""));
    setAssigneeId(f.users.some((u) => u.id === keep.assigneeId) ? keep.assigneeId : "");
    setDeliverableId(f.deliverables.some((x) => x.id === keep.deliverableId) ? keep.deliverableId : "");
    if (f.project.id !== board.project.id) setEvergreen(false);
  };
  const selectProject = async (id: string) => {
    if (id === projectId) return;
    const keep = { kindId, columnId: "", assigneeId, deliverableId: "" };
    setProjectId(id);
    wantedProject.current = id;
    const ready = id === board.project.id ? boardForm : formCache.current.get(id);
    if (ready) {
      if (id !== board.project.id) setOther(ready);
      return applyForm(ready, keep);
    }
    const res = await getProjectFormData(id).catch(() => ({ ok: false as const, error: t("Error inesperado. Inténtalo de nuevo.") }));
    if (wantedProject.current !== id) return;
    if (!res.ok) {
      toast(res.error, "error");
      wantedProject.current = board.project.id;
      setProjectId(board.project.id);
      return applyForm(boardForm, keep);
    }
    formCache.current.set(id, res.data);
    setOther(res.data);
    applyForm(res.data, keep);
  };
  // Borrador de otro proyecto: se cargan sus opciones y se comprueba que el tipo, la columna, etc. sigan existiendo.
  useEffect(() => {
    if (!foreignInit || !d) return;
    let live = true;
    void getProjectFormData(initialProject).then((res) => {
      if (!live || wantedProject.current !== initialProject) return;
      if (!res.ok) {
        wantedProject.current = board.project.id;
        setProjectId(board.project.id);
        return applyForm(boardForm, d);
      }
      formCache.current.set(initialProject, res.data);
      setOther(res.data);
      applyForm(res.data, d);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
    // Solo al abrir con un borrador de otro proyecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Borrador cada 5 s; cancelar o crear lo borra (los archivos no se guardan en el borrador).
  const discardDraft = useDraftAutosave(draftKey("new", board.currentUserId, board.project.id), () =>
    !autosave
      ? undefined
      : !title.trim() && !description.trim() && !subtasks.length && !subtaskDraft.trim()
        ? null
        : ({ title, kindId, description, columnId, assigneeId, dueDate, deliverableId, evergreen, subtasks, subtaskDraft, projectId } satisfies NewTaskDraft),
  );
  const onClose = () => {
    if (autosave) discardDraft();
    close();
  };
  // Escape, clic fuera, X o «Cancelar» con contenido escrito piden confirmación; crear no.
  const confirming = useRef(false);
  const requestClose = async () => {
    const dirty = !!(title.trim() || description.trim() || subtasks.length || subtaskDraft.trim());
    if (dirty) {
      // Una sola confirmación a la vez (Escape o clics repetidos no las apilan).
      if (confirming.current) return;
      confirming.current = true;
      const ok = await confirm({ title: t("Descartar la nueva tarea"), message: t("Hay cambios sin guardar. ¿Descartar la nueva tarea?"), confirmLabel: t("Descartar"), danger: true });
      confirming.current = false;
      if (!ok) return;
    }
    onClose();
  };
  const isReleaseColumn = form.columns.find((c) => c.id === columnId)?.role === "NEXT_RELEASE";
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
    if (busy || loading || !title.trim() || !columnId) return;
    setBusy(true);
    // Una subtarea a medio escribir también se guarda al crear.
    const pending = subtaskDraft.trim().slice(0, 200);
    const subtaskTitles = pending && subtasks.length < 50 ? [...subtasks, pending] : subtasks;
    const res = await board.track(
      createTask({
        projectId, columnId, title, kindId, description,
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
    // En otro proyecto la tarjeta no es de este tablero: no se añade (se avisa con un enlace al proyecto).
    const elsewhere = projectId !== board.project.id;
    if (!elsewhere) board.upsertTask(task);
    // Los archivos se suben en paralelo tras crear la tarea.
    const results = await Promise.allSettled(files.map((f) => board.trackRaw(uploadFile(task.id, f, true, t))));
    const uploaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const ok = uploaded.length;
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (ok && !elsewhere) {
      for (const a of uploaded) task = { ...task, ...attachmentPatch(task, a) };
      board.upsertTask(task);
    }
    if (failed) toast((failed.reason as Error).message, "error");
    if (elsewhere) toast(t("Tarea creada en «{project}»", { project: form.project.name }), "success", { label: t("Ir al proyecto"), onClick: () => router.push(`/p/${projectId}`) });
    else if (!failed) toast(t("Tarea creada"));
    onClose();
    if (!elsewhere) board.revealTask(task.id);
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
      onClose={requestClose}
      side={side}
      onAddSecond={onAddSecond}
      title={
        <span className="-m-1 flex min-w-0 items-center gap-2 p-1">
          <span className="shrink-0">{t("Nueva tarea")}</span>
          {projects.length > 1 && (
            <>
              <select
                aria-label={t("Proyecto")}
                title={t("Proyecto en el que se crea la tarea")}
                className="input h-8 min-w-0 flex-1 py-0 text-sm font-normal sm:max-w-64 sm:flex-none"
                value={projectId}
                onChange={(e) => void selectProject(e.target.value)}
              >
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {loading && <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" aria-label={t("Cargando…")} />}
            </>
          )}
        </span>
      }
      size="md"
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={requestClose}>{t("Cancelar")}</button>
          <button type="submit" form={formId} className="btn-primary" disabled={busy || loading || !title.trim()} title={`${t("Crear tarea")} (${sc("Alt+S")})`}>
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
          <TypeSelector kinds={form.kinds} value={kindId} onChange={(id) => {
            if (loading) return;
            setKindId(id);
            // Tipo especial «Respuesta»: título y primera línea de la descripción predefinidos.
            const kind = form.kinds.find((k) => k.id === id);
            const preset = kind ? applyKindTemplate(kind, { title, description }) : null;
            if (preset) {
              setTitle(preset.title);
              setDescription(preset.description);
            }
            // Subtareas predefinidas del tipo: se añaden a las que haya, sin repetir.
            if (kind?.subtaskTemplate.length) setSubtasks((l) => mergeSubtasks(l, kind.subtaskTemplate));
          }} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor={`${uid}-desc`}>{t("Descripción (opcional)")}</label>
            <DescriptionTools value={description} onClear={() => setDescription("")} className="mb-1" />
          </div>
          <DescriptionField id={`${uid}-desc`} mode={board.editorMode} textareaClassName="input field-sizing-content min-h-14" value={description} onValueChange={setDescription} users={form.users} maxLength={20000} placeholder={t("Markdown · @persona para avisar")} />
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
            <select id={`${uid}-column`} className="input" value={columnId} disabled={loading} onChange={(e) => setColumnId(e.target.value)}>
              {form.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-deliverable`}>{t("Entregable (opcional)")}</label>
            <select id={`${uid}-deliverable`} className="input" value={deliverableId} disabled={loading} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">{t("Sin entregable")}</option>
              {form.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-assignee`}>{t("Asignada a (opcional)")}</label>
            <select id={`${uid}-assignee`} className="input" value={assigneeId} disabled={loading} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t("Sin asignar")}</option>
              {form.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? t("{name} (yo)", { name: u.name }) : u.name}</option>)}
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
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 has-[:focus-visible]:border-focus has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus dark:border-slate-700">
              <ImagePlus size={16} /> {t("Archivo")}
              <input type="file" multiple className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 has-[:focus-visible]:border-focus has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus sm:hidden dark:border-slate-700">
              <Camera size={16} /> {t("Cámara")}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <AttachLimitHint
              className="self-center max-sm:hidden" usedBytes={files.reduce((n, f) => n + f.size, 0)} limitMb={form.project.attachMaxMb} fileMaxMb={form.project.fileMaxMb}
            />
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
