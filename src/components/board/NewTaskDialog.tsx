"use client";

import { Camera, File as FileIcon, ImagePlus, Loader2, Paperclip, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createTask, getProjectFormData } from "@/actions/tasks";
import { ProjectsContext } from "../ProjectMenu";
import { ProjectPicker } from "./ProjectPicker";
import { DescriptionTools, descriptionTooLong } from "../ui/DescriptionTools";
import type { BoardTask, ProjectFormData } from "@/lib/types";
import { clampTitle } from "@/lib/title-clamp";
import { cn } from "../ui/cn";
import { overTitleLimit, TITLE_INPUT_LIMIT, TITLE_INVALID_CLASSES, TitleLimitHint } from "./TitleLimit";
import { useT, useIntlLocale } from "@/i18n/client";
import { useConfirm } from "../ui/ConfirmDialog";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { useShortcut } from "./shortcuts";
import { useToast } from "../ui/Toast";
import { boardClients, useBoard, useTasks } from "./context";
import { fieldsError, fieldsForCreate, TaskFieldsGroup, type FieldsForm } from "./TaskFieldsGroup";
import { fieldsForDraft, fieldsFromDraft } from "@/lib/fields-form";
import { DescriptionField } from "../ui/DescriptionField";
import { DictationButton, insertIntoField } from "../ui/DictationButton";
import { pasteAsOneLine } from "../ui/textarea-edit";
import { usePasteFiles } from "../ui/pasteFiles";
import { applyKindTemplate, mergeSubtasks } from "@/lib/kinds-special";
import { MAX_DESCRIPTION, MAX_TITLE } from "@/lib/constants";
import { TypeSelector } from "./TaskDialog";
import type { T } from "@/i18n/core";
import { AttachLimitHint } from "./AttachLimitHint";
import { UploadProgress } from "./UploadProgress";
import { batchErrorMessage, filesFrom, formatBytes, isImageFile, skippedMessage, uploadBatch, useFileDrop, type BatchProgress } from "./upload";
import { planUploads } from "@/lib/upload-queue";
import { sortByFileName } from "@/lib/attachment-sort";
import { subtaskLines } from "@/lib/subtask-lines";
import { documentDownloadName, type DocumentKindName } from "@/lib/document-kind";
import { draftKey, useDraftAutosave, type NewTaskDraft } from "./drafts";
import { actionThrowResult } from "@/lib/stale-action";
import { subtasksDidNotFit } from "./count-texts";

interface Props {
  initialColumnId?: string;
  /** Crear la tarea como fija en la release (solo si la columna es la de la release). */
  initialEvergreen?: boolean;
  initialFiles?: File[];
  /** Descripción con la que se abre (p. ej. el enlace al documento desde el que se crea la tarea). */
  initialDescription?: string;
  /** Documento abierto en el visor desde el que se crea la tarea: ofrece un botón para adjuntarlo. */
  attachDocument?: { id: string; name: string; kind?: DocumentKindName };
  onClose: () => void;
  /** Escritorio: posición en pantalla cuando hay dos modales a la vez. */
  side?: "left" | "right" | "center";
  /** Escritorio: muestra el «+» para abrir un segundo modal de nueva tarea al lado. */
  onAddSecond?: () => void;
  /** Escritorio: con `onAddSecond`, añade el botón de «Varias tareas» encima del «+». */
  onAddSecondBulk?: () => void;
  /** Muestra el selector de proyecto (solo el segundo diálogo de la pareja); el primero crea siempre en el tablero abierto. */
  pickProject?: boolean;
  /** Borrador recuperado (la página se cerró con el modal abierto). */
  draft?: NewTaskDraft | null;
  /** Guarda un borrador local cada 5 s (solo el modal principal). */
  autosave?: boolean;
}

/** Subtareas que admite «Nueva tarea» al crear (el servidor rechaza más). */
const MAX_NEW_SUBTASKS = 50;

/** Subtarea de la lista, con una clave local estable (al quitar una, React no reutiliza la fila de otra). */
type SubtaskItem = { key: string; text: string };
let subtaskSeq = 0;
const subtaskItem = (text: string): SubtaskItem => ({ key: `s${++subtaskSeq}`, text });

function captureTitle(t: T, locale: string): string {
  return t("Captura") + " " + new Date().toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

export function NewTaskDialog({ initialColumnId, initialEvergreen, initialFiles, initialDescription, attachDocument, onClose: close, side, onAddSecond, onAddSecondBulk, pickProject = false, draft, autosave = false }: Props) {
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
  const initialProject = pickProject && d?.projectId && d.projectId !== board.project.id && projects.some((p) => p.id === d.projectId) ? d.projectId : board.project.id;
  const foreignInit = initialProject !== board.project.id;
  const [projectId, setProjectId] = useState(initialProject);
  // Opciones del proyecto elegido cuando no es el abierto (se piden al servidor y se guardan mientras el diálogo siga abierto).
  const [other, setOther] = useState<ProjectFormData | null>(null);
  const formCache = useRef(new Map<string, ProjectFormData>());
  const wantedProject = useRef(initialProject);
  const boardTasks = useTasks();
  const boardForm = useMemo<ProjectFormData>(
    () => ({ project: board.project, columns: board.columns, users: board.users, kinds: board.kinds, deliverables: board.deliverables, labels: board.labels, clients: boardClients(boardTasks) }),
    [board.project, board.columns, board.users, board.kinds, board.deliverables, board.labels, boardTasks],
  );
  const pf = projectId === board.project.id ? boardForm : other?.project.id === projectId ? other : null;
  // Mientras llegan las opciones de otro proyecto se muestran las del abierto, sin poder crear.
  const loading = !pf;
  const form = pf ?? boardForm;
  const titleRef = useRef<HTMLInputElement>(null);
  // Archivos de entrada (pegar / soltar sobre «Nueva tarea»): mismos límites que al añadirlos dentro del diálogo.
  const [initialPlan] = useState(() => planUploads(initialFiles ?? [], { fileMaxBytes: board.project.fileMaxMb * 1024 * 1024, remainingBytes: board.project.attachMaxMb * 1024 * 1024 }));
  const [title, setTitle] = useState(() => d?.title ?? (initialPlan.accepted.length ? captureTitle(t, locale) : ""));
  const [kindId, setKindId] = useState(!foreignInit && d && board.kindById.has(d.kindId) ? d.kindId : foreignInit ? "" : (board.kinds[0]?.id ?? ""));
  const [columnId, setColumnId] = useState(!foreignInit && d && board.columns.some((c) => c.id === d.columnId) ? d.columnId : foreignInit ? "" : (initialColumnId ?? board.columns[0]?.id ?? ""));
  const [assigneeId, setAssigneeId] = useState(foreignInit ? "" : (d?.assigneeId ?? ""));
  const [dueDate, setDueDate] = useState(d?.dueDate ?? "");
  const [deliverableId, setDeliverableId] = useState(foreignInit ? "" : (d?.deliverableId ?? ""));
  const [description, setDescription] = useState(d?.description ?? initialDescription ?? "");
  const [files, setFiles] = useState<File[]>(() => sortByFileName(initialPlan.accepted, (f) => f.name, locale));
  const [subtaskItems, setSubtaskItems] = useState<SubtaskItem[]>(() => (d?.subtasks ?? []).map(subtaskItem));
  const subtasks = useMemo(() => subtaskItems.map((s) => s.text), [subtaskItems]);
  const [subtaskDraft, setSubtaskDraft] = useState(d?.subtaskDraft ?? "");
  const [evergreen, setEvergreen] = useState(foreignInit ? false : (d?.evergreen ?? !!initialEvergreen));
  // Campos opcionales del proyecto elegido (el borrador guarda los activados).
  const [fieldsForm, setFieldsForm] = useState<FieldsForm>(() => fieldsFromDraft(d?.fields));

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
    const res = await getProjectFormData(id).catch((e) => actionThrowResult(e, t));
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
        : ({ title, kindId, description, columnId, assigneeId, dueDate, deliverableId, evergreen, subtasks, subtaskDraft, projectId, fields: loading ? fieldsForm : fieldsForDraft(fieldsForm, form.project.taskFields) } satisfies NewTaskDraft),
  );
  // Si el diálogo ya no está montado (cierre del padre, navegación), una subida tardía no cierra ni descarta nada ajeno.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const onClose = () => {
    if (!alive.current) return;
    if (autosave) discardDraft();
    close();
  };
  // Aviso de los archivos de entrada omitidos (una sola vez al abrir).
  const warnedInitial = useRef(false);
  useEffect(() => {
    if (warnedInitial.current || !initialPlan.skipped.length) return;
    warnedInitial.current = true;
    toast(skippedMessage(t, locale, initialPlan.skipped, board.project.fileMaxMb), "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Escape, clic fuera, X o «Cancelar» con contenido escrito piden confirmación; crear no.
  const confirming = useRef(false);
  const busyRef = useRef(false);
  // `false` si no se cerró (el botón atrás del móvil vuelve entonces a poder cerrarlo).
  const requestClose = async (): Promise<boolean> => {
    // Mientras se crea la tarea y se suben sus archivos no se cierra (se ve el progreso): cerrar a medias dejaría la subida huérfana.
    if (busyRef.current) return false;
    const dirty = !!(title.trim() || (description.trim() && description !== initialDescription) || subtasks.length || subtaskDraft.trim());
    if (dirty) {
      // Una sola confirmación a la vez (Escape o clics repetidos no las apilan).
      if (confirming.current) return false;
      confirming.current = true;
      const ok = await confirm({ title: t("Descartar la nueva tarea"), message: t("Hay cambios sin guardar. ¿Descartar la nueva tarea?"), confirmLabel: t("Descartar"), danger: true });
      confirming.current = false;
      if (!ok) return false;
    }
    onClose();
    return true;
  };
  // La columna elegida ya no existe (otra persona la borró con el diálogo abierto): el selector mostraba otra, pero se
  // seguía enviando la borrada y crear fallaba siempre. Se pasa a una que exista (la de partida o la primera) y se avisa.
  const [lostColumn, setLostColumn] = useState<{ name: string } | null>(null);
  if (!loading && columnId && form.columns.length && !form.columns.some((c) => c.id === columnId)) {
    const next = (form.project.id === board.project.id ? form.columns.find((c) => c.id === initialColumnId) : undefined) ?? form.columns[0]!;
    setColumnId(next.id);
    setLostColumn({ name: next.name });
  }
  useEffect(() => {
    if (lostColumn) toast(t("La columna elegida ya no existe. La tarea se creará en «{name}».", { name: lostColumn.name }), "error");
  }, [lostColumn, toast, t]);
  const isReleaseColumn = form.columns.find((c) => c.id === columnId)?.role === "NEXT_RELEASE";
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const imageIndexes = files.flatMap((f, i) => (isImageFile(f) ? [i] : []));

  // Los archivos se muestran (y se suben) por nombre, como en el detalle de la tarea.
  const byName = (list: File[]) => sortByFileName(list, (f) => f.name, locale);
  const addFiles = (list: File[]) => {
    if (!list.length) return;
    // Sin tope de cantidad: solo el tamaño de cada archivo y la suma de la tarea. Lo omitido se avisa de una vez.
    const { fileMaxMb, attachMaxMb } = form.project;
    const { accepted, skipped } = planUploads(list, { fileMaxBytes: fileMaxMb * 1024 * 1024, remainingBytes: attachMaxMb * 1024 * 1024 - files.reduce((n, f) => n + f.size, 0) });
    if (skipped.length) toast(skippedMessage(t, locale, skipped, fileMaxMb), "error");
    if (!accepted.length) return;
    setFiles((prev) => byName([...prev, ...accepted]));
    // Con una captura y sin título, se propone uno para ir más rápido.
    setTitle((cur) => cur || captureTitle(t, locale));
  };

  const dropping = useFileDrop(addFiles);

  // Adjuntar el documento del visor: se descarga con la sesión y entra como un archivo más (mismos límites que los demás).
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const docAttached = !!docFile && files.includes(docFile);
  const attachOpenDocument = async () => {
    if (!attachDocument || docLoading || docAttached) return;
    const name = attachDocument.name;
    const fileMax = form.project.fileMaxMb * 1024 * 1024;
    setDocLoading(true);
    try {
      const res = await fetch(`/api/documents/${attachDocument.id}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(t("No se pudo descargar el documento."));
      const blob = await res.blob();
      if (blob.size > fileMax) return toast(t("«{name}» pesa {size} y el máximo por archivo es {mb} MB.", { name, size: formatBytes(blob.size, locale), mb: form.project.fileMaxMb }), "error");
      if (files.reduce((n, f) => n + f.size, 0) + blob.size > form.project.attachMaxMb * 1024 * 1024) {
        return toast(t("«{name}» no cabe: se superaría el máximo de {mb} MB de adjuntos de la tarea.", { name, mb: form.project.attachMaxMb }), "error");
      }
      const file = new File([blob], documentDownloadName(name, attachDocument.kind ?? "OTHER"), { type: blob.type || "application/octet-stream" });
      setDocFile(file);
      setFiles((prev) => byName([...prev, file]));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t("No se pudo descargar el documento."), "error");
    } finally {
      setDocLoading(false);
    }
  };

  // Pegar varias líneas en «Añadir subtarea» crea una subtarea por línea (sin viñetas); una sola línea se pega normal.
  const pasteSubtasks = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = /[\r\n]/.test(text) && !e.clipboardData.files.length ? subtaskLines(text, MAX_TITLE) : [];
    if (lines.length < 2) return pasteAsOneLine(e, setSubtaskDraft);
    e.preventDefault();
    const room = Math.max(0, MAX_NEW_SUBTASKS - subtasks.length);
    const added = lines.slice(0, room);
    if (added.length) setSubtaskItems((l) => [...l, ...added.map(subtaskItem)].slice(0, MAX_NEW_SUBTASKS));
    if (added.length < lines.length) toast(subtasksDidNotFit(t, added.length, lines.length - added.length, MAX_NEW_SUBTASKS), "error");
  };

  const addSubtaskDraft = () => {
    const text = subtaskDraft.trim();
    if (!text) return;
    setSubtaskItems((l) => (l.length >= MAX_NEW_SUBTASKS ? l : [...l, subtaskItem(text.slice(0, 200))]));
    setSubtaskDraft("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || busyRef.current || loading || !title.trim() || !columnId) return;
    if (description.length > MAX_DESCRIPTION) return toast(descriptionTooLong(t, locale, MAX_DESCRIPTION), "error");
    const fieldsErr = fieldsError(fieldsForm, form.project.taskFields, dueDate, t);
    if (fieldsErr) return toast(fieldsErr, "error");
    setBusy(true);
    busyRef.current = true;
    // Una subtarea a medio escribir también se guarda al crear.
    // Un título más largo que el máximo no se rechaza: se crea recortado y se avisa.
    const sent = clampTitle(title.trim());
    const pending = subtaskDraft.trim().slice(0, 200);
    const subtaskTitles = pending && subtasks.length < MAX_NEW_SUBTASKS ? [...subtasks, pending] : subtasks;
    const res = await board.track(
      createTask({
        projectId, columnId, title: sent.value, kindId, description,
        assigneeId: assigneeId || null, dueDate: dueDate || null, deliverableId: deliverableId || null,
        evergreen: isReleaseColumn && evergreen,
        subtasks: subtaskTitles,
        ...fieldsForCreate(fieldsForm, form.project.taskFields),
      }),
    ).catch((e) => actionThrowResult(e, t));
    if (!res.ok) {
      setBusy(false);
      busyRef.current = false;
      return toast(res.error, "error");
    }
    const { titleClipped, ...created } = res.data;
    let task: BoardTask = created;
    // En otro proyecto la tarjeta no es de este tablero: no se añade (se avisa con un enlace al proyecto).
    const elsewhere = projectId !== board.project.id;
    if (!elsewhere) board.upsertTask(task);
    // Los archivos se suben tras crear la tarea, por una cola de 3 a la vez.
    const batch = await uploadBatch(task.id, files, { onCreate: true, t, track: board.trackRaw, onProgress: setProgress });
    setProgress(null);
    const { uploaded } = batch;
    const ok = uploaded.length;
    const failed = batchErrorMessage(t, batch.errors, batch.notSent);
    if (ok && !elsewhere) {
      // Las subidas van en paralelo: sus respuestas pueden llegar desordenadas; vale la que ya cuenta todas las que se guardaron.
      const latest = uploaded.reduce((best, a) => (a.totals.imageCount + a.totals.fileCount > best.imageCount + best.fileCount ? a.totals : best), uploaded[0]!.totals);
      task = { ...task, ...latest };
      board.upsertTask(task);
    }
    if (failed) toast(failed, "error");
    if (sent.clipped || titleClipped) toast(t("Título recortado a {max} caracteres", { max: titleClipped ?? MAX_TITLE }));
    if (elsewhere) toast(t("Tarea creada en «{project}»", { project: form.project.name }), "success", { label: t("Ir al proyecto"), onClick: () => router.push(`/p/${projectId}`) });
    else if (!failed) toast(t("Tarea creada"));
    onClose();
    if (!elsewhere && alive.current) board.revealTask(task.id);
  };

  // Alt+S crea la tarea (también escribiendo), como Ctrl+Enter. Con dos modales a la vez, el que tiene el foco.
  const formRef = useRef<HTMLFormElement>(null);
  // Pegar archivos (Ctrl/⌘+V) con el foco en cualquier parte del diálogo, también fuera de las cajas: una vez por pegado.
  usePasteFiles(addFiles, () => formRef.current?.closest("[role=dialog]") ?? null);
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
      onAddSecondBulk={onAddSecondBulk}
      title={
        <span className="-m-1 flex min-w-0 items-center gap-2 p-1">
          <span className="shrink-0">{t("Nueva tarea")}</span>
          {pickProject && <ProjectPicker value={projectId} onChange={(id) => void selectProject(id)} loading={loading} />}
        </span>
      }
      size="md"
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>{t("Cancelar")}</button>
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
      }}>
        <div>
          <label className="label" htmlFor={`${uid}-title`}>{t("Título")}</label>
          <div className="relative">
            <input ref={titleRef} id={`${uid}-title`} className={cn("peer input min-w-0 w-full pr-10", overTitleLimit(title) && TITLE_INVALID_CLASSES)} value={title} onChange={(e) => setTitle(e.target.value)} onPaste={(e) => pasteAsOneLine(e, setTitle)} maxLength={TITLE_INPUT_LIMIT} aria-invalid={overTitleLimit(title) || undefined} aria-describedby={overTitleLimit(title) ? `${uid}-title-hint` : undefined} required data-autofocus />
            <DictationButton onText={(s) => insertIntoField(titleRef.current, s, setTitle)} within={() => titleRef.current?.parentElement?.parentElement ?? null} placement="inside" whileEditing className="top-1/2 -translate-y-1/2" />
          </div>
          <TitleLimitHint id={`${uid}-title-hint`} value={title} className="mt-1" />
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
            // mergeSubtasks conserva las que hay al principio y añade detrás: solo las nuevas llevan clave nueva.
            if (kind?.subtaskTemplate.length) setSubtaskItems((l) => [...l, ...mergeSubtasks(l.map((x) => x.text), kind.subtaskTemplate).slice(l.length).map(subtaskItem)]);
          }} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor={`${uid}-desc`}>{t("Descripción (opcional)")}</label>
            <DescriptionTools value={description} onClear={() => setDescription("")} className="mb-1" max={MAX_DESCRIPTION} />
          </div>
          <DescriptionField id={`${uid}-desc`} mode={board.editorMode} textareaClassName="input field-sizing-content min-h-14" value={description} onValueChange={setDescription} users={form.users} placeholder={t("Markdown · @persona para avisar")} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-subtask`}>{t("Subtareas (opcional)")}</label>
          {subtasks.length > 0 && (
            <ul className="mb-1.5 space-y-0.5">
              {subtaskItems.map((s) => (
                <li key={s.key} className="flex items-center gap-2 rounded-md bg-slate-50 py-0.5 pr-0.5 pl-2 text-sm dark:bg-slate-800/50">
                  <span className="min-w-0 flex-1 break-words">{s.text}</span>
                  <button type="button" className="btn-icon h-6 w-6 shrink-0" onClick={() => setSubtaskItems((l) => l.filter((x) => x.key !== s.key))} aria-label={t("Quitar la subtarea «{name}»", { name: s.text })}>
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
              maxLength={MAX_TITLE}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onPaste={pasteSubtasks}
              onKeyDown={(e) => {
                // Enter añade la subtarea sin enviar el formulario; Ctrl/Cmd+Enter sigue creando la tarea.
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addSubtaskDraft();
                }
              }}
            />
            <button type="button" className="btn-secondary py-1.5" disabled={!subtaskDraft.trim() || subtasks.length >= MAX_NEW_SUBTASKS} onClick={addSubtaskDraft} aria-label={t("Añadir subtarea")}>
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
        <TaskFieldsGroup
          enabled={form.project.taskFields}
          value={fieldsForm}
          onChange={(p) => setFieldsForm((f) => ({ ...f, ...p }))}
          dueDate={dueDate || null}
          clients={form.clients}
          disabled={loading}
        />
        {isReleaseColumn && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} />
            {t("Fija en la release (evergreen)")}
          </label>
        )}
        <div>
          <div className="label">{files.length ? t("Capturas y adjuntos ({n})", { n: files.length }) : t("Capturas y adjuntos")}</div>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${previews[i]}`} className="relative">
                {isImageFile(f) ? (
                  <button type="button" className="block" onClick={() => setLightbox(imageIndexes.indexOf(i))} aria-label={t("Ver {name}", { name: f.name })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[i]} alt="" className="h-14 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
                  </button>
                ) : (
                  <div className="flex h-14 max-w-40 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs dark:border-slate-700 dark:bg-slate-800" title={f.name}>
                    <FileIcon size={16} className="shrink-0 text-slate-500" />
                    <span className="line-clamp-2 break-all">{f.name}</span>
                  </div>
                )}
                <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-900 p-0.5 text-white" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label={t("Quitar «{name}»", { name: f.name })}>
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
            {attachDocument && (
              <button
                type="button"
                data-testid="attach-open-document"
                onClick={() => void attachOpenDocument()}
                disabled={docAttached || docLoading}
                title={docAttached ? t("«{name}» ya está adjunto", { name: attachDocument.name }) : t("Adjuntar «{name}»", { name: attachDocument.name })}
                className="flex h-14 max-w-48 min-w-20 items-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 px-2 text-left text-xs text-slate-600 hover:border-brand-500 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-50 disabled:hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:disabled:hover:border-slate-700"
              >
                {docLoading ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <Paperclip size={16} className="shrink-0" />}
                <span className="line-clamp-2 break-all">{t("Adjuntar «{name}»", { name: attachDocument.name })}</span>
              </button>
            )}
            <AttachLimitHint
              className="self-center max-sm:hidden" usedBytes={files.reduce((n, f) => n + f.size, 0)} limitMb={form.project.attachMaxMb} fileMaxMb={form.project.fileMaxMb}
            />
          </div>
        </div>
      </form>
      {progress && <UploadProgress progress={progress} className="mt-3" />}

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
