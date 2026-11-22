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
import { useLocale, useT, useIntlLocale } from "@/i18n/client";
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
import { pasteClaimed, pastedFiles, usePasteFiles } from "../ui/pasteFiles";
import { copyText } from "../ui/clipboard";
import { appTimeZone, formatDate } from "@/lib/format";
import { parseTasksText, strictJsonFormat, stringifyTaskJson } from "@/lib/task-json";
import { fillNewTaskForm, foldName, newTaskFormJson, type FormProject } from "@/lib/task-json-form";
import { acceptsPastedText, eventIsFor } from "./taskClipboard";
import { TaskJsonButtons } from "./TaskJsonButtons";
import { switchKindDescription, switchKindSubtasks, switchKindText, switchKindTitle } from "@/lib/kinds-special";
import { initialKindId, rememberKind } from "./lastKind";
import { hasEvergreenTasks, MAX_DESCRIPTION, MAX_TASK_LABELS, MAX_TITLE, PALETTE } from "@/lib/constants";
import { ColorPopover, TypeSelector } from "./TaskDialog";
import { LabelToggles } from "./LabelToggles";
import { isHttpUrl, normalizeLinkUrl } from "@/lib/link-url";
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
import { fetchErrorMessage, loadWhenOnline } from "@/lib/connection";
import { subtasksDidNotFit } from "./count-texts";
import { RecurrencePicker } from "./RecurrencePicker";
import { defaultRecurrenceDay, RECURRENCES, type RecurrenceRule } from "@/lib/recurrence-date";

interface Props {
  initialColumnId?: string;
  /** Crear la tarea como fija en la release (solo si la columna es la de la release). */
  initialEvergreen?: boolean;
  initialFiles?: File[];
  /** Descripción con la que se abre (p. ej. el enlace al documento desde el que se crea la tarea). */
  initialDescription?: string;
  /**
   * Título con el que se abre (lo compartido con «Compartir → Pizarro»). El tipo preseleccionado aplica su plantilla
   * igualmente, pero sin sustituir este título, y lo que llega así cuenta como escrito (cerrar pide confirmación).
   */
  initialTitle?: string;
  /** Documento abierto en el visor desde el que se crea la tarea: ofrece un botón para adjuntarlo. */
  attachDocument?: { id: string; name: string; kind?: DocumentKindName };
  /** Al cerrar, recibe el proyecto en el que se creó la tarea (o, al cancelar, el último elegido en el selector). */
  onClose: (projectId: string) => void;
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
  return t("Captura") + " " + formatDate(new Date(), "dateTime", locale);
}

export function NewTaskDialog({ initialColumnId, initialEvergreen, initialFiles, initialDescription, initialTitle, attachDocument, onClose: close, side, onAddSecond, onAddSecondBulk, pickProject = false, draft, autosave = false }: Props) {
  const t = useT();
  const uiLocale = useLocale();
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
  // Tipo: el del borrador; si no, el último con el que esta persona creó una tarea en el proyecto (lastKind.ts); si no, el primero.
  // Sin borrador, el tipo inicial trae su automatización (título y descripción de plantilla y subtareas), como al elegirlo
  // en el selector: antes solo se aplicaba al cambiar de tipo y el preseleccionado se quedaba sin ella. Un borrador
  // recuperado se queda como estaba (no se le añade nada).
  const [init] = useState(() => {
    const kindId = !foreignInit && d && board.kindById.has(d.kindId) ? d.kindId : foreignInit ? "" : initialKindId(board.currentUserId, board.project.id, board.kinds);
    const title = d?.title ?? initialTitle ?? (initialPlan.accepted.length ? captureTitle(t, locale) : "");
    const description = d?.description ?? initialDescription ?? "";
    const subtasks = d?.subtasks ?? [];
    const kind = d ? undefined : board.kinds.find((k) => k.id === kindId);
    if (!kind) return { kindId, title, description, subtasks, templated: false };
    const next = switchKindText(null, kind, { title, description, subtasks });
    // Lo compartido trae su título: el del tipo no lo sustituye.
    if (initialTitle?.trim()) next.title = title;
    const changed = next.title !== title || next.description !== description || next.subtasks.length !== subtasks.length;
    return { kindId, ...next, templated: changed && initialTitle === undefined };
  });
  const [title, setTitle] = useState(init.title);
  const [kindId, setKindId] = useState(init.kindId);
  const [columnId, setColumnId] = useState(!foreignInit && d && board.columns.some((c) => c.id === d.columnId) ? d.columnId : foreignInit ? "" : (initialColumnId ?? board.columns[0]?.id ?? ""));
  const [assigneeId, setAssigneeId] = useState(foreignInit ? "" : (d?.assigneeId ?? ""));
  const [dueDate, setDueDate] = useState(d?.dueDate ?? "");
  // Repetir (como en el detalle). Mientras no se elija a mano, el día de la semana o del mes sigue a la fecha límite.
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(() => (d?.recurrence && RECURRENCES.includes(d.recurrence) ? d.recurrence : "NONE"));
  const [recurrenceDay, setRecurrenceDay] = useState<number | null>(() => (typeof d?.recurrenceDay === "number" ? d.recurrenceDay : null));
  // Del borrador se recupera si se eligió a mano: antes se daba por elegido siempre que hubiera día, y tras reabrir el
  // diálogo el día ya no seguía a la fecha límite (una tarea con fecha en viernes se repetía, por ejemplo, los jueves).
  const dayPicked = useRef(recurrenceDay !== null && d?.recurrenceDayPicked === true);
  const changeDue = (v: string) => {
    setDueDate(v);
    if (!dayPicked.current && (recurrence === "WEEKLY" || recurrence === "MONTHLY") && v.slice(0, 4) >= "1900") setRecurrenceDay(defaultRecurrenceDay(recurrence, v, board.today));
  };
  const [deliverableId, setDeliverableId] = useState(foreignInit ? "" : (d?.deliverableId ?? ""));
  const [description, setDescription] = useState(init.description);
  const [files, setFiles] = useState<File[]>(() => sortByFileName(initialPlan.accepted, (f) => f.name, locale));
  const [subtaskItems, setSubtaskItems] = useState<SubtaskItem[]>(() => init.subtasks.map(subtaskItem));
  const subtasks = useMemo(() => subtaskItems.map((s) => s.text), [subtaskItems]);
  const [subtaskDraft, setSubtaskDraft] = useState(d?.subtaskDraft ?? "");
  const [evergreen, setEvergreen] = useState(foreignInit ? false : (d?.evergreen ?? !!initialEvergreen));
  // Campos opcionales del proyecto elegido (el borrador guarda los activados).
  const [fieldsForm, setFieldsForm] = useState<FieldsForm>(() => fieldsFromDraft(d?.fields));
  // Etiquetas (solo las que ya existen en el proyecto: aquí no se crean), color de la tarjeta y enlace externo, como en el detalle.
  const [labelIds, setLabelIds] = useState<string[]>(() => {
    const ids = Array.isArray(d?.labelIds) ? d.labelIds.filter((x): x is string => typeof x === "string") : [];
    return (foreignInit ? ids : ids.filter((id) => board.labels.some((l) => l.id === id))).slice(0, MAX_TASK_LABELS);
  });
  const [color, setColor] = useState<string | null>(() => (typeof d?.color === "string" && (PALETTE as readonly string[]).includes(d.color) ? d.color : null));
  const [linkUrl, setLinkUrl] = useState(() => (typeof d?.linkUrl === "string" ? d.linkUrl : ""));

  /**
   * Formulario tal como lo dejó la plantilla del tipo, sin nada de la persona (eso no cuenta como escrito: cerrar no
   * pregunta y no se guarda de borrador). null cuando ya hay algo suyo (o lo importado) o el tipo no puso nada.
   */
  const templateState = useRef<{ kindId: string; title: string; description: string; subtasks: string[] } | null>(
    init.templated ? { kindId: init.kindId, title: init.title, description: init.description, subtasks: init.subtasks } : null,
  );
  /** ¿Sigue el formulario tal como lo dejó la automatización del tipo? (eso no cuenta como escrito ni se guarda de borrador). */
  const templateOnly = () => {
    const s = templateState.current;
    return !!s && kindId === s.kindId && title === s.title && description === s.description && subtasks.join("\n") === s.subtasks.join("\n") && !subtaskDraft.trim() && !labelIds.length && !color && !linkUrl.trim();
  };
  /** ¿Hay algo escrito o elegido? (cerrar pide confirmación e importar pregunta antes de sustituirlo). */
  const isDirty = () => !templateOnly() && !!(title.trim() || (description.trim() && description !== initialDescription) || subtasks.length || subtaskDraft.trim() || labelIds.length || color || linkUrl.trim());
  /**
   * Elige el tipo `id` (de `kinds`) y aplica su automatización (kinds-special.ts, `switchKind…`): lo que sigue tal como lo
   * puso el tipo anterior (`prev`) se sustituye por lo del nuevo; lo escrito o cambiado se conserva y se añade lo del
   * nuevo sin duplicar. Antes se acumulaba (dos formularios en la descripción y las subtareas de los dos tipos).
   */
  const applyKind = (id: string, kinds: ProjectFormData["kinds"], prev: ProjectFormData["kinds"][number] | undefined = form.kinds.find((k) => k.id === kindId)) => {
    const pristine = !isDirty();
    setKindId(id);
    const kind = kinds.find((k) => k.id === id);
    if (!kind) return;
    // Con actualizaciones funcionales: tras pedir las opciones de otro proyecto, lo escrito mientras tanto no se pierde.
    setTitle((cur) => switchKindTitle(prev, kind, cur));
    setDescription((cur) => switchKindDescription(prev, kind, cur));
    // Las subtareas que se quedan conservan su clave (React no reutiliza la fila de otra); solo las nuevas llevan una nueva.
    setSubtaskItems((l) => {
      const pool = [...l];
      return switchKindSubtasks(prev, kind, l.map((x) => x.text)).map((text) => {
        const i = pool.findIndex((x) => x.text === text);
        return i >= 0 ? pool.splice(i, 1)[0]! : subtaskItem(text);
      });
    });
    // Si no había nada de la persona, lo que pone el tipo nuevo tampoco cuenta como escrito.
    templateState.current = pristine ? { kindId: id, ...switchKindText(prev, kind, { title, description, subtasks }) } : null;
  };
  /** Ajusta las opciones al proyecto de `f`: conserva lo que siga existiendo en él y, si no, usa su primera columna / tipo. */
  const applyForm = (f: ProjectFormData, keep: { kindId: string; prevKind?: ProjectFormData["kinds"][number]; columnId: string; assigneeId: string; deliverableId: string; labelNames?: string[]; restoring?: boolean }) => {
    // Etiquetas: al cambiar de proyecto se quedan las que también existen en el nuevo (por nombre); las demás se quitan.
    const names = keep.labelNames;
    if (names) setLabelIds(f.labels.filter((l) => names.some((n) => foldName(n) === foldName(l.name))).map((l) => l.id).slice(0, MAX_TASK_LABELS));
    else setLabelIds((ids) => ids.filter((id) => f.labels.some((l) => l.id === id)));
    // Si el tipo no existe en el proyecto nuevo, el que lo sustituye trae su automatización (salvo al recuperar un borrador).
    if (f.kinds.some((k) => k.id === keep.kindId)) setKindId(keep.kindId);
    else if (keep.restoring) setKindId(initialKindId(board.currentUserId, f.project.id, f.kinds));
    else applyKind(initialKindId(board.currentUserId, f.project.id, f.kinds), f.kinds, keep.prevKind);
    setColumnId(f.columns.some((c) => c.id === keep.columnId) ? keep.columnId : f.project.id === board.project.id ? (initialColumnId ?? f.columns[0]?.id ?? "") : (f.columns[0]?.id ?? ""));
    setAssigneeId(f.users.some((u) => u.id === keep.assigneeId) ? keep.assigneeId : "");
    setDeliverableId(f.deliverables.some((x) => x.id === keep.deliverableId) ? keep.deliverableId : "");
    if (f.project.id !== board.project.id) setEvergreen(false);
  };
  const selectProject = async (id: string) => {
    if (id === projectId) return;
    const keep = { kindId, prevKind: form.kinds.find((k) => k.id === kindId), columnId: "", assigneeId, deliverableId: "", labelNames: form.labels.filter((l) => labelIds.includes(l.id)).map((l) => l.name) };
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
    // Sin red se pide al volver la conexión (antes el fallo se ignoraba y el formulario se quedaba cargando).
    return loadWhenOnline(() => getProjectFormData(initialProject), (res) => {
      if (wantedProject.current !== initialProject) return;
      if (!res.ok) {
        wantedProject.current = board.project.id;
        setProjectId(board.project.id);
        return applyForm(boardForm, { ...d, restoring: true });
      }
      formCache.current.set(initialProject, res.data);
      setOther(res.data);
      applyForm(res.data, { ...d, restoring: true });
    }, () => {
      if (wantedProject.current !== initialProject) return;
      wantedProject.current = board.project.id;
      setProjectId(board.project.id);
      applyForm(boardForm, { ...d, restoring: true });
    });
    // Solo al abrir con un borrador de otro proyecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Borrador cada 5 s; cancelar o crear lo borra (los archivos no se guardan en el borrador).
  const discardDraft = useDraftAutosave(draftKey("new", board.currentUserId, board.project.id), () =>
    !autosave
      ? undefined
      : templateOnly() || (!title.trim() && !description.trim() && !subtasks.length && !subtaskDraft.trim() && !labelIds.length && !color && !linkUrl.trim())
        ? null
        : ({ title, kindId, description, columnId, assigneeId, dueDate, deliverableId, evergreen, subtasks, subtaskDraft, projectId, fields: loading ? fieldsForm : fieldsForDraft(fieldsForm, form.project.taskFields), recurrence, recurrenceDay, recurrenceDayPicked: dayPicked.current, labelIds, color, linkUrl } satisfies NewTaskDraft),
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
    close(projectId);
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
    if (isDirty()) {
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
  // La release y los planes de trabajo para IA tienen tareas fijas («Siempre en la release» / «Siempre en el plan»).
  const columnRole = form.columns.find((c) => c.id === columnId)?.role;
  const isReleaseColumn = hasEvergreenTasks(columnRole);
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
      toast(fetchErrorMessage(e, t("Sin conexión: no se ha podido descargar el documento."), t("No se pudo descargar el documento.")), "error");
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
    // Enlace: la misma normalización que el detalle («example.com/x» → https://…) y la misma regla que el servidor.
    const link = normalizeLinkUrl(linkUrl);
    if (link && (link.length > 2000 || !isHttpUrl(link))) return toast(t("El enlace debe empezar por http:// o https://"), "error");
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
        recurrence, recurrenceDay,
        color: color as never, linkUrl: link || null,
        labelIds: labelIds.filter((id) => form.labels.some((l) => l.id === id)),
        subtasks: subtaskTitles,
        ...fieldsForCreate(fieldsForm, form.project.taskFields),
      }),
    ).catch((e) => actionThrowResult(e, t));
    if (!res.ok) {
      setBusy(false);
      busyRef.current = false;
      return toast(res.error, "error");
    }
    rememberKind(board.currentUserId, projectId, kindId);
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
    if (sent.clipped || titleClipped) toast(t("Título recortado a {max} caracteres", { max: titleClipped ?? sent.limit ?? MAX_TITLE }));
    if (elsewhere) toast(t("Tarea creada en «{project}»", { project: form.project.name }), "success", { label: t("Ir al proyecto"), onClick: () => router.push(`/p/${projectId}`) });
    else if (!failed) toast(t("Tarea creada"));
    onClose();
    if (!elsewhere && alive.current) board.revealTask(task.id);
  };

  // --- La tarea en JSON (lib/task-json.ts): copiar lo que hay en el formulario e importar una tarea en él ---
  const formProject = useMemo<FormProject>(
    () => ({ kinds: form.kinds, columns: form.columns, users: form.users, deliverables: form.deliverables, labels: form.labels, enabledFields: form.project.taskFields }),
    [form],
  );
  /** Copia lo escrito como JSON de tarea (sin `info`: aún no es una tarea guardada). */
  const copyForm = async () => {
    const pending = subtaskDraft.trim().slice(0, 200);
    const json = newTaskFormJson(
      { title, kindId, description, columnId, assigneeId, dueDate, deliverableId, recurrence, recurrenceDay, subtasks: pending ? [...subtasks, pending] : subtasks, fields: fieldsForm, labelIds, color, linkUrl },
      formProject,
    );
    if (await copyText(stringifyTaskJson(json))) toast(t("Tarea copiada"));
    else toast(t("No se ha podido copiar al portapapeles."), "error");
  };
  /**
   * Rellena el formulario con la tarea en JSON de `text` (una sola; varias se importan desde el tablero). Si ya hay algo
   * escrito, pregunta antes de sustituirlo. Lo que el formulario no admite se avisa. `true` si se importó.
   */
  const importForm = async (text: string): Promise<boolean> => {
    // Con la zona horaria de la aplicación, como el resto de importaciones: la fecha límite de Trello (un instante UTC)
    // cae en su día de aquí, no en el de UTC.
    const read = parseTasksText(text, { t, timeZone: appTimeZone(), locale: uiLocale });
    if (read.error) {
      toast(read.error, "error");
      return false;
    }
    if (read.tasks.length > 1 || read.tooMany) {
      toast(t("Hay {n} tareas. Para importar varias, usa «Importar» en el tablero.", { n: read.total }), "error");
      return false;
    }
    const one = read.tasks[0];
    if (!one) {
      toast(read.total || read.tooLong ? t("El JSON de la tarea no es válido.") : t("No hay ninguna tarea en JSON."), "error");
      return false;
    }
    if (loading || busyRef.current) return false;
    if (isDirty() && !(await confirm({ title: t("Sustituir lo escrito"), message: t("La nueva tarea ya tiene contenido. ¿Sustituirlo por la tarea importada?"), confirmLabel: t("Sustituir"), danger: true }).catch(() => false))) return false;
    const { form: fill, notices } = fillNewTaskForm(one.task, one.problems, formProject, MAX_NEW_SUBTASKS, t);
    // Lo importado es contenido de la persona: el tipo que traiga no le aplica su plantilla.
    templateState.current = null;
    setTitle(fill.title ?? "");
    setDescription(fill.description ?? "");
    setSubtaskItems((fill.subtasks ?? []).map(subtaskItem));
    setSubtaskDraft("");
    if (fill.kindId) setKindId(fill.kindId);
    if (fill.columnId) setColumnId(fill.columnId);
    if (fill.assigneeId !== undefined) setAssigneeId(fill.assigneeId);
    if (fill.deliverableId !== undefined) setDeliverableId(fill.deliverableId);
    if (fill.dueDate !== undefined) setDueDate(fill.dueDate);
    if (fill.recurrence) {
      setRecurrence(fill.recurrence);
      dayPicked.current = fill.recurrenceDay !== null && fill.recurrenceDay !== undefined;
      setRecurrenceDay(fill.recurrenceDay ?? defaultRecurrenceDay(fill.recurrence, fill.dueDate ?? (dueDate || null), board.today));
    }
    if (fill.fields) setFieldsForm((f) => ({ ...f, ...fill.fields }));
    if (fill.labelIds) setLabelIds(fill.labelIds);
    if (fill.color !== undefined) setColor(fill.color);
    if (fill.linkUrl !== undefined) setLinkUrl(fill.linkUrl);
    if (notices.length) {
      const shown = notices.slice(0, 4).join("; ");
      toast(t("Tarea importada, salvo: {list}", { list: notices.length > 4 ? t("{list} y {n} más", { list: shown, n: notices.length - 4 }) : shown }), "error");
    } else toast(t("Tarea importada"));
    // Fecha límite y de inicio en órdenes distintos (día/mes y mes/día): se avisa para que se revisen.
    if (read.dateWarning) toast(read.dateWarning, "error");
    return true;
  };
  const importRef = useRef(importForm);
  /**
   * ¿Un pegado de una tarea en JSON en esta caja de texto rellena el formulario? Sí en el título vacío (el foco está ahí al
   * abrir «Nueva tarea») y en cualquier caja mientras el formulario está sin tocar; si no, se pega como texto.
   */
  // Un título que solo trae la plantilla del tipo (sin tocar) cuenta como vacío: pegar ahí una tarea la importa.
  const pasteFillsForm = (target: EventTarget | null) => (target instanceof Node && !!titleRef.current?.contains(target) && (!title.trim() || title === templateState.current?.title)) || !isDirty();
  const pasteFillsRef = useRef(pasteFillsForm);
  useEffect(() => {
    importRef.current = importForm;
    pasteFillsRef.current = pasteFillsForm;
  });

  // Alt+S crea la tarea (también escribiendo), como Ctrl+Enter. Con dos modales a la vez, el que tiene el foco.
  const formRef = useRef<HTMLFormElement>(null);
  // Ctrl+V / ⌘V (o «Pegar» del menú del navegador) con EXACTAMENTE una tarea en JSON en el portapapeles: rellena el
  // formulario. Fuera de una caja de texto, siempre; dentro, en el título vacío o con el formulario sin tocar (pasteFillsForm).
  // Varias tareas («pizarro.tasks») avisan de que se importan desde el tablero. Con cualquier otra cosa (o con archivos) el
  // pegado sigue su curso. Va en la fase de captura: el título y las subtareas tienen su propio onPaste (pegar en una línea),
  // que antes metía el JSON en el título como texto, y el editor de la descripción también se queda el pegado.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dialog = formRef.current?.closest("[role=dialog]");
      if (e.defaultPrevented || pasteClaimed(e) || !eventIsFor(dialog, e.target) || pastedFiles(e).length) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!strictJsonFormat(text)) return;
      if (acceptsPastedText(e.target) && !pasteFillsRef.current(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      void importRef.current(text);
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);
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
      // Copiar lo escrito como JSON o importar una tarea (portapapeles o fichero): junto a la X, como en el detalle de una
      // tarea; en el móvil, juntos en «⋯».
      headerActions={<TaskJsonButtons onCopy={() => void copyForm()} onImport={importForm} shortcuts={{ paste: true }} compactOnMobile />}
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
            applyKind(id, form.kinds);
          }} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor={`${uid}-desc`}>{t("Descripción")}</label>
            <DescriptionTools value={description} onClear={() => setDescription("")} className="mb-1" max={MAX_DESCRIPTION} />
          </div>
          <DescriptionField id={`${uid}-desc`} mode={board.editorMode} textareaClassName="input field-sizing-content min-h-14" value={description} onValueChange={setDescription} users={form.users} placeholder={t("Markdown · @persona para avisar")} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-subtask`}>{t("Subtareas")}</label>
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
            <button type="button" className="btn-secondary touch-target py-1.5" disabled={!subtaskDraft.trim() || subtasks.length >= MAX_NEW_SUBTASKS} onClick={addSubtaskDraft} aria-label={t("Añadir subtarea")}>
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
            <label className="label truncate" htmlFor={`${uid}-deliverable`}>{t("Entregable")}</label>
            <select id={`${uid}-deliverable`} className="input" value={deliverableId} disabled={loading} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">{t("Sin entregable")}</option>
              {form.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-assignee`}>{t("Responsable")}</label>
            <select id={`${uid}-assignee`} className="input" value={assigneeId} disabled={loading} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t("Sin responsable")}</option>
              {form.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? t("{name} (yo)", { name: u.name }) : u.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-due`}>{t("Fecha límite")}</label>
            <input id={`${uid}-due`} type="date" className="input" value={dueDate} onChange={(e) => changeDue(e.target.value)} />
          </div>
          <div className="col-span-2 min-w-0">
            <label className="label" htmlFor={`${uid}-repeat`}>{t("Repetir")}</label>
            {/* Mismas dos columnas que los campos de arriba: la regla y, si es semanal o mensual, el día. */}
            <RecurrencePicker
              id={`${uid}-repeat`}
              rule={recurrence}
              day={recurrenceDay}
              onRule={(r) => {
                setRecurrence(r);
                dayPicked.current = false;
                setRecurrenceDay(defaultRecurrenceDay(r, dueDate || null, board.today));
              }}
              onDay={(n) => {
                dayPicked.current = true;
                setRecurrenceDay(n);
              }}
              className="grid grid-cols-2 gap-x-3"
            />
          </div>
          <div className="min-w-0">
            <div className="label truncate">{t("Color")}</div>
            <ColorPopover value={color} onChange={setColor} />
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor={`${uid}-link`}>{t("Enlace externo")}</label>
            <input
              id={`${uid}-link`}
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://…"
              maxLength={2000}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              // Como en el detalle: «example.com/x» pasa a «https://example.com/x» al salir del campo.
              onBlur={() => setLinkUrl((v) => normalizeLinkUrl(v))}
              onPaste={(e) => pasteAsOneLine(e, setLinkUrl)}
            />
          </div>
          {form.labels.length > 0 && (
            <div className="col-span-2 min-w-0" role="group" aria-labelledby={`${uid}-labels`}>
              <div className="label" id={`${uid}-labels`}>{t("Etiquetas")}</div>
              <LabelToggles
                labels={form.labels}
                selected={labelIds}
                max={MAX_TASK_LABELS}
                onToggle={(id, on) => !loading && setLabelIds((ids) => (on ? [...ids, id].slice(0, MAX_TASK_LABELS) : ids.filter((x) => x !== id)))}
              />
            </div>
          )}
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
            {columnRole === "AI_PLAN" ? t("Siempre en el plan (fija)") : t("Fija en la release")}
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
