"use client";

import { takePrefetchedTaskDetail } from "./taskDetailPrefetch";
import { Archive, Camera, Check, ChevronDown, Copy, Download, ExternalLink, File as FileIcon, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, FileVideo, GripVertical, ImagePlus, Loader2, Pencil, Plus, Presentation, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  addSubtask, addSubtasks, archiveTask, deleteAttachment, deleteSubtask, deleteTask, deleteTaskLink, getTaskDetail,
  moveTask, reorderSubtask, restoreTaskSnapshot, updateSubtask, updateTask,
} from "@/actions/tasks";
import { undoEntry, undoLast } from "@/actions/undo";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useIntlLocale, useT } from "@/i18n/client";
import { dueStatus } from "@/lib/dates";
import { mentionsToPlain } from "@/lib/mentions";
import { defaultRecurrenceDay, type RecurrenceRule } from "@/lib/recurrence-date";
import { COLOR_NAME, isWhite, kindBadgeStyle, MAX_SUBTASKS, MAX_TITLE, onColor, swatchBorder } from "@/lib/constants";
import type { BoardTask, KindOption, SubtaskInfo, TaskDetail, TaskLinkInfo, UserOption } from "@/lib/types";
import { ColorPicker } from "../ui/ColorPicker";
import { cn } from "../ui/cn";
import { DescriptionField } from "../ui/DescriptionField";
import { DescriptionTools, descriptionTooLong } from "../ui/DescriptionTools";
import { GoogleFileIcon } from "../ui/googleFiles";
import { MAX_DESCRIPTION } from "@/lib/constants";
import { Markdown } from "../ui/Markdown";
import type { MentionCommand } from "../ui/MentionTextarea";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { Popover } from "../ui/Popover";
import { applyKindTemplate } from "@/lib/kinds-special";
import { useConfirm } from "../ui/ConfirmDialog";
import { copyText } from "../ui/clipboard";
import { pasteAsOneLine } from "../ui/textarea-edit";
import { usePasteFiles } from "../ui/pasteFiles";
import { isSessionExpiredMessage, useToast } from "../ui/Toast";
import { isOfflineMessage, loadWhenOnline } from "@/lib/connection";
import { actionThrowMessage } from "@/lib/stale-action";
import { textHash, type TextSince } from "@/lib/text-version";
import { boardClients, useBoard } from "./context";
import { subtaskDragA11y } from "./drag-a11y";
import { isTypingTarget, useShortcut } from "./shortcuts";
import { RecurrencePicker } from "./RecurrencePicker";
import { TaskViewers } from "./TaskViewers";
import { Comments } from "./TaskComments";
import { FollowToggle } from "./FollowToggle";
import { TaskHistory } from "./TaskHistory";
import { TitleField } from "./TitleField";
import { BlockerPicker } from "./BlockerPicker";
import { createAndOpenGoogleFile, shareWarning } from "./google";
import { AttachLimitHint } from "./AttachLimitHint";
import { attachmentTotalsOf } from "@/lib/attachment-totals";
import { UploadProgress } from "./UploadProgress";
import { batchErrorMessage, createProgressAggregator, filesFrom, formatBytes, monotonicTotals, skippedMessage, uploadBatch, useFileDrop, type BatchProgress } from "./upload";
import { planUploads } from "@/lib/upload-queue";
import { formatDate } from "@/lib/format";
import { normalizeLinkUrl } from "@/lib/link-url";
import { sortByFileName } from "@/lib/attachment-sort";
import { subtaskBatch, subtaskLines } from "@/lib/subtask-lines";
import { fieldsError, fieldsFormOf, fieldsPatch, TaskFieldsGroup, type FieldsForm } from "./TaskFieldsGroup";
import { draftKey, readCommentDraft, useDraftAutosave, type EditTaskDraft } from "./drafts";
import { setUndoTask, UNDONE_EVENT } from "../undo-context";
import { useIsMobile } from "../ui/useIsMobile";
import { UndoButton } from "../UndoButton";
import { subtasksDidNotFit } from "./count-texts";

export function TaskDialog({ task, onClose: close, side, onAddSecond, onAddSecondBulk, draft, gone }: {
  task: BoardTask;
  onClose: () => void;
  /** La tarea ya no está en el tablero (otra persona la borró o archivó): el aviso. El diálogo lo muestra y se cierra. */
  gone?: string;
  side?: "left" | "right" | "center";
  onAddSecond?: () => void;
  onAddSecondBulk?: () => void;
  /** Borrador recuperado (la página se cerró con la tarea abierta). */
  draft?: EditTaskDraft | null;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const board = useBoard();
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();
  const sc = useShortcut();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState(draft?.title ?? task.title);
  // Descripción en edición (la comunica el editor): para el botón Guardar y el borrador local.
  const descDraft = useRef<string | null>(null);
  // Texto vivo de la descripción abierta (sin el retardo del borrador): lo que Guardar debe enviar.
  const descLive = useRef<string | null>(null);
  // Las subtareas (nueva a medio escribir, renombrado en curso) se guardan con este callback al pulsar Guardar.
  const flushSubtasks = useRef<(() => Promise<boolean>) | null>(null);
  const [draftUsed, setDraftUsed] = useState(false);
  // Borrador local cada 5 s: al volver tras cerrar la página, la tarea se reabre con lo escrito.
  // Solo hay borrador si queda algo sin guardar; si no, se borra (no se reabre una tarea ya cerrada).
  const discardDraft = useDraftAutosave(draftKey("edit", board.currentUserId, board.project.id), (): EditTaskDraft | null => {
    const desc = descDraft.current;
    const descChanged = desc !== null && desc !== (detail?.description ?? "");
    if (title === task.title && !descChanged) return null;
    return { taskId: task.id, ...(detail ? { base: detail.textVersion } : {}), ...(title !== task.title ? { title } : {}), ...(descChanged ? { description: desc } : {}) };
  });
  const onClose = () => {
    discardDraft();
    close();
  };
  // Subtarea nueva a medio escribir (la comunica la lista de subtareas): cerrar con ella pide confirmación.
  const subtaskDraftPending = useRef<(() => boolean) | null>(null);
  // ¿La descripción abierta tiene cambios de la persona? (la comunica el editor; ver DescriptionEditor).
  const descDirtyCheck = useRef<(() => boolean) | null>(null);
  // ¿Hay un comentario en edición con cambios? (lo comunica la lista de comentarios).
  const commentEditDirty = useRef<(() => boolean) | null>(null);
  // Cierre en curso: «confirming» mientras se pregunta, «discarding» tras «Descartar cambios». En ambos, salir del campo
  // de renombrar una subtarea no la guarda: al abrirse la pregunta el campo pierde el foco (atrás en el móvil, clic fuera)
  // y antes eso guardaba el renombrado aunque luego se eligiera descartar.
  const closeGuard = useRef<"idle" | "confirming" | "discarding">("idle");
  const blurHeld = useCallback(() => closeGuard.current !== "idle", []);
  // El último guardado del título o del enlace falló (sin conexión, sesión caducada…) y lo escrito sigue en el campo:
  // cerrar pregunta antes de descartarlo (ver requestClose).
  const textSaveFailed = useRef(false);
  // Último guardado en curso del título o del enlace (para esperar su resultado al cerrar).
  const textSaving = useRef<Promise<boolean> | null>(null);
  /** Título o enlace escritos que difieren de lo guardado tras un guardado fallido (lee lo último, también tras esperar). */
  const unsavedAfterFailure = (): boolean => {
    if (!textSaveFailed.current) return false;
    const { title: typed, link: typedLink } = textState.current;
    const saved = board.getTask(task.id) ?? task;
    const value = typed.trim();
    return (!!value && value !== saved.title) || normalizeLinkUrl(typedLink) !== (saved.linkUrl ?? "");
  };
  /**
   * Cerrar con la X, clic fuera, Escape o el botón atrás: si la descripción tiene cambios sin guardar, hay una subtarea a
   * medio escribir o renombrándose, o un comentario en edición con cambios, se pregunta antes de descartarlos; sin cambios
   * se cierra directamente. Lo que se guarda al salir de su campo (título, enlace, campos opcionales) se guarda también al
   * cerrar. `false` si no se cerró.
   */
  const requestClose = async (): Promise<boolean> => {
    if (closeGuard.current !== "idle") return false;
    const desc = descLive.current;
    const descDirty = desc !== null && desc !== (detail?.description ?? "") && (descDirtyCheck.current?.() ?? true);
    const subDirty = subtaskDraftPending.current?.() ?? false;
    const commentDirty = commentEditDirty.current?.() ?? false;
    if (descDirty || subDirty || commentDirty) {
      closeGuard.current = "confirming";
      const ok = await confirm({
        title: t("Cambios sin guardar"),
        message: [descDirty, subDirty, commentDirty].filter(Boolean).length > 1
          ? descDirty && subDirty && !commentDirty
            ? t("La descripción tiene cambios sin guardar y hay una subtarea a medio escribir. ¿Cerrar la tarea y descartarlos?")
            : t("Hay varios cambios sin guardar (descripción, subtareas o un comentario en edición). ¿Cerrar la tarea y descartarlos?")
          : descDirty
            ? t("La descripción tiene cambios sin guardar. ¿Cerrar la tarea y descartarlos?")
            : subDirty
              ? t("Hay una subtarea a medio escribir. ¿Cerrar la tarea y descartarla?")
              : t("Estás editando un comentario y tiene cambios sin guardar. ¿Cerrar la tarea y descartarlos?"),
        confirmLabel: t("Descartar cambios"),
        cancelLabel: t("Seguir editando"),
        danger: true,
      }).catch(() => false);
      closeGuard.current = ok ? "discarding" : "idle";
      if (!ok) return false;
    }
    // Título o enlace escritos y sin guardar: al salir del campo se guardan (abajo) y se espera a ver si se guardaron.
    const textPending = textSaveFailed.current || (!!title.trim() && title.trim() !== task.title) || normalizeLinkUrl(link) !== (task.linkUrl ?? "");
    // Salir del campo con el foco guarda lo que se guarda al salir (blur): sin esto, Escape o el clic fuera lo perdían.
    // Tras «Descartar cambios» el renombrado de una subtarea no se guarda (ver closeGuard).
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.closest("[role=dialog]")?.contains(active)) active.blur();
    if (textPending && closeGuard.current === "idle") {
      // Si no se pudo guardar (sin conexión, sesión caducada, otro error), lo escrito sigue en el campo: antes el diálogo se
      // cerraba igual y se perdía, borrador incluido. Ahora se pregunta.
      closeGuard.current = "confirming";
      // El guardado empieza al salir del campo (justo arriba): se espera a su resultado.
      await new Promise((r) => setTimeout(r, 0));
      await textSaving.current;
      const ok = !unsavedAfterFailure() || await confirm({
        title: t("Cambios sin guardar"),
        message: t("No se ha podido guardar el título o el enlace. ¿Cerrar la tarea y descartarlo?"),
        confirmLabel: t("Descartar cambios"),
        cancelLabel: t("Seguir editando"),
        danger: true,
      }).catch(() => false);
      closeGuard.current = "idle";
      if (!ok) return false;
    }
    onClose();
    return true;
  };

  // Si el título cambia desde fuera (otra persona, deshacer, recarga tras un conflicto), se muestra el nuevo, pero solo
  // si no se está editando: lo que se esté escribiendo (distinto de lo que se mostraba) no se pisa, como el enlace. Antes
  // se sustituía siempre y, cuando otra persona guardaba su título, lo escrito aquí se perdía sin aviso. Al guardarlo, se
  // envía el título sobre el que se escribió (`titleBase`, que no sigue al de la tarjeta mientras se edita), así que el
  // servidor responde con el conflicto y el aviso ofrece «Copiar tu texto» (ver `save`). Si el guardado falla, la
  // tarjeta vuelve a lo guardado y el campo, que mostraba lo enviado, pasa al título actual.
  const [shownTitle, setShownTitle] = useState(task.title);
  if (shownTitle !== task.title) {
    setShownTitle(task.title);
    if (title === shownTitle) setTitle(task.title);
  }
  // Se incrementa al cambiar la descripción desde fuera del editor para que se remonte con el texto nuevo.
  const [descVersion, setDescVersion] = useState(0);
  // Se incrementa cuando otra persona (u otra pestaña) cambia la descripción: el editor muestra la nueva sin remontarse
  // (ver DescriptionEditor, `remote`).
  const [descRemote, setDescRemote] = useState(0);
  const [link, setLink] = useState(task.linkUrl ?? "");
  // Como el título: si el enlace cambia desde fuera (deshacer, otra persona), se muestra el nuevo. Sin esto el campo
  // seguía con el anterior y «Guardar» lo volvía a escribir, deshaciendo el cambio ajeno.
  const [shownLink, setShownLink] = useState(task.linkUrl ?? "");
  if (shownLink !== (task.linkUrl ?? "")) {
    setShownLink(task.linkUrl ?? "");
    // Lo que se esté escribiendo (distinto de lo que se mostraba) no se pisa.
    if (link === shownLink) setLink(task.linkUrl ?? "");
  }
  // Campos opcionales del proyecto: formulario local que se guarda al salir de cada campo.
  const enabledFields = board.project.taskFields;
  const [fieldsForm, setFieldsForm] = useState<FieldsForm>(() => fieldsFormOf(task));
  const savedFieldsSig = JSON.stringify(fieldsFormOf(task));
  const [shownFields, setShownFields] = useState(savedFieldsSig);
  if (shownFields !== savedFieldsSig) {
    // Cambió lo guardado (al guardar un campo, deshacer, otra persona): se muestra lo nuevo, pero solo en los campos que
    // cambiaron. Antes se reponía el formulario entero y, al guardarse el coste, se borraban las horas que se estaban
    // escribiendo en ese momento.
    const before = JSON.parse(shownFields) as FieldsForm;
    const saved = fieldsFormOf(task);
    setShownFields(savedFieldsSig);
    setFieldsForm((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(saved) as (keyof FieldsForm)[]) if (saved[k] !== before[k]) (next as Record<string, unknown>)[k] = saved[k];
      return next;
    });
  }
  const [uploading, setUploading] = useState(0);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  // Varias tandas a la vez suman en un solo progreso, que se limpia cuando acaban todas.
  const [progressAgg] = useState(() => createProgressAggregator(setProgress));
  // Cancelar o cerrar el diálogo aborta las subidas que aún no han empezado (las que van en curso terminan).
  const uploadAbort = useRef(new AbortController());
  useEffect(() => {
    return () => uploadAbort.current.abort();
  }, []);
  // Una subida se rechazó por el máximo de adjuntos de la tarea: se resalta el total hasta que se borre algo.
  const [totalRejected, setTotalRejected] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Cómo estaba la tarea al abrir el diálogo (para «Cancelar»): la tarjeta al montar y el detalle en su primera carga.
  const initialTask = useRef(task);
  const initialDetail = useRef<TaskDetail | null>(null);
  // Desde cuándo cuenta lo que se hace en el diálogo: la hora del servidor al cargar el detalle (sin depender del reloj
  // del navegador) o, si no llegó a cargarse, la del navegador al abrirlo.
  const [openedAtLocal] = useState(() => new Date().toISOString());
  const [cancelling, setCancelling] = useState(false);
  // Versión del texto contra la que se guarda: la del detalle, adelantada al instante por cada guardado propio (ver `save`).
  // `ownTextVersion`: la del último guardado de texto de este diálogo («Cancelar» la usa: lo que cambie después, aunque
  // sea desde otra pestaña, no se pisa).
  const textVersion = useRef<string | null | undefined>(undefined);
  const ownTextVersion = useRef<string | null | undefined>(undefined);
  const textSaves = useRef<Promise<unknown>>(Promise.resolve());
  useLayoutEffect(() => {
    textVersion.current = detail?.textVersion;
  }, [detail?.textVersion]);

  // Borrador recuperado: su texto se escribió sobre una versión anterior (la de `base`), y se guarda contra ella.
  const draftBaseAtOpen = draft && draft.taskId === task.id && (draft.title !== undefined || draft.description !== undefined) && (typeof draft.base === "string" || draft.base === null) ? draft.base : undefined;
  const draftBase = useRef(draftBaseAtOpen);
  // Texto sobre el que se escribe (para que el servidor compruebe el conflicto campo a campo, ver text-version.ts): el
  // título que se mostraba al empezar a escribirlo (sigue al de la tarjeta mientras no se edita) y la descripción cargada
  // o guardada aquí por última vez. Con un borrador recuperado no se sabe (se escribió sobre una versión anterior): hasta
  // el primer guardado se envía solo la versión y cualquier cambio posterior del texto es un conflicto, como antes.
  const titleBase = useRef(task.title);
  const descBase = useRef<string | null>(null);
  const knownBase = useRef(draftBaseAtOpen === undefined);
  // Guardados del título en curso: la tarjeta ya muestra el título enviado (optimista), que no es aún el del servidor.
  const titleSaves = useRef(0);
  useEffect(() => {
    if (title === shownTitle && !titleSaves.current) titleBase.current = shownTitle;
  });
  const textSince = (): string | null | TextSince => {
    const version = textVersion.current !== undefined ? textVersion.current : task.textVersion;
    if (!knownBase.current) return version;
    return { version, title: textHash(titleBase.current), ...(descBase.current !== null ? { description: textHash(descBase.current) } : {}) };
  };
  // Sin red (también la petición adelantada al hacer clic) se repite sola al volver la conexión: antes se quedaba el
  // esqueleto para siempre, también con la red ya de vuelta.
  useEffect(() => {
    let first = true;
    return loadWhenOnline(
      () => {
        const prefetched = first ? takePrefetchedTaskDetail(task.id) : null;
        first = false;
        return prefetched ?? getTaskDetail(task.id);
      },
      (res) => {
        if (!res.ok) return toast(res.error, "error");
        initialDetail.current ??= res.data;
        const base = draftBase.current;
        draftBase.current = undefined;
        // Con un borrador recuperado, lo escrito se apoya en una versión anterior: no se sabe sobre qué título y
        // descripción, así que se comprueba todo el texto (ver `textSince`) hasta el primer guardado.
        knownBase.current = base === undefined;
        descBase.current = res.data.description;
        setDetail(base !== undefined ? { ...res.data, textVersion: base } : res.data);
      },
      (err) => toast(actionThrowMessage(err, t), "error"),
    );
  }, [task.id, toast, t]);

  // Texto cambiado desde fuera (otra persona u otra pestaña, en vivo). El título nuevo ya lo muestra el campo si no se
  // está editando (ver `shownTitle`); la descripción se vuelve a leer y, si cambió y aquí no se está editando, se muestra
  // la nueva (antes se seguía viendo la anterior). Sin nada en edición, la versión del texto avanza con ella; si se está
  // editando un campo, se queda en la versión sobre la que se escribe y, al guardarlo, el servidor avisa si otra persona
  // cambió ese mismo campo (un cambio en el otro campo no es un conflicto, ver `textSince`).
  const seenText = useRef(task.textVersion);
  const textState = useRef({ detail, title, shownTitle, version: task.textVersion, link });
  useEffect(() => {
    textState.current = { detail, title, shownTitle, version: task.textVersion, link };
  });
  /** ¿La descripción abierta tiene cambios de la persona? */
  const editingDescription = () => {
    const { detail: d } = textState.current;
    const desc = descLive.current;
    return !!d && desc !== null && desc !== d.description && (descDirtyCheck.current?.() ?? true);
  };
  const editingText = () => textState.current.title !== textState.current.shownTitle || editingDescription();
  useEffect(() => {
    if (task.textVersion === seenText.current) return;
    seenText.current = task.textVersion;
    if (!detail || detail.textVersion === task.textVersion) return;
    let alive = true;
    void getTaskDetail(task.id).catch(() => null).then((res) => {
      const { detail: d, version } = textState.current;
      if (!alive || !res?.ok || !d || res.data.textVersion !== version) return;
      const fresh = res.data.description;
      const reloadDesc = fresh !== d.description && !editingDescription();
      if (reloadDesc) descBase.current = fresh;
      const advance = !editingText();
      if (!reloadDesc && !advance) return;
      setDetail((cur) => (cur ? { ...cur, ...(reloadDesc ? { description: fresh } : {}), ...(advance ? { textVersion: res.data.textVersion } : {}) } : cur));
      if (reloadDesc) setDescRemote((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar la versión del texto de la tarjeta
  }, [task.textVersion]);

  // Indicador «Guardando… / Guardado»: cuenta los guardados en curso de este diálogo.
  const [saving, setSaving] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const tracked = async <T extends { ok: boolean }>(p: Promise<T>): Promise<T> => {
    clearTimeout(savedTimer.current);
    setJustSaved(false);
    setSaving((n) => n + 1);
    try {
      const res = await board.track(p);
      if (res.ok) {
        setJustSaved(true);
        savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
      }
      return res;
    } finally {
      setSaving((n) => n - 1);
    }
  };

  /** Vuelve a leer la tarea (p. ej. si otra persona cambió su texto mientras se editaba, o tras deshacer). */
  const reload = async () => {
    // Sin red la acción lanza: no se recarga (y no queda una promesa rechazada sin atender).
    const res = await getTaskDetail(task.id).catch(() => null);
    if (!res?.ok) return;
    descBase.current = res.data.description;
    knownBase.current = true;
    setDetail(res.data);
    setDescVersion((n) => n + 1);
    board.refresh();
  };
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Contexto del deshacer: con la tarea abierta, deshacer actúa sobre ella y luego se recarga.
  useEffect(() => {
    setUndoTask(task.id);
    const onUndone = (e: Event) => {
      if ((e as CustomEvent<{ taskId: string }>).detail?.taskId === task.id) void reloadRef.current();
    };
    window.addEventListener(UNDONE_EVENT, onUndone);
    return () => {
      setUndoTask(null);
      window.removeEventListener(UNDONE_EVENT, onUndone);
    };
  }, [task.id]);

  // La tarea ha desaparecido (otra persona la borró o archivó): antes el detalle se esfumaba sin aviso, con lo escrito, y
  // si luego se deshacía volvía a abrirse solo. Ahora se avisa (quién, si se sabe), se ofrece copiar lo que no estaba
  // guardado (título, descripción y comentario a medio escribir) y se cierra del todo.
  useEffect(() => {
    if (!gone) return;
    const typed = textState.current.title.trim();
    const desc = descLive.current;
    const parts = [
      typed && typed !== task.title ? mentionsToPlain(typed) : "",
      desc !== null && desc !== (textState.current.detail?.description ?? "") && (descDirtyCheck.current?.() ?? true) ? desc : "",
      mentionsToPlain(readCommentDraft(board.currentUserId, task.id)?.text ?? ""),
    ].filter((x) => x.trim());
    const text = parts.join("\n\n");
    toast(gone, "error", text ? { label: t("Copiar tu texto"), onClick: () => void copyText(text).then((ok) => ok && toast(t("Copiado al portapapeles"))) } : undefined);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando desaparece
  }, [gone]);

  /**
   * Botón Guardar / Alt+S: guarda TODO lo que se esté editando aunque aún no se haya confirmado (título,
   * descripción abierta, enlace, subtarea nueva o en renombrado) y cierra. Si algo falla, no cierra.
   */
  const saveAndClose = async () => {
    const value = title.trim();
    const patch: { title?: string; description?: string; linkUrl?: string } = {};
    if (value && value !== task.title) patch.title = value;
    const desc = descLive.current;
    if (desc !== null && desc.length > MAX_DESCRIPTION) return toast(descriptionTooLong(t, locale, MAX_DESCRIPTION), "error");
    if (desc !== null && desc !== (detail?.description ?? "")) patch.description = desc;
    const linkValue = normalizeLinkUrl(link);
    if (linkValue !== link) setLink(linkValue);
    if (linkValue !== (task.linkUrl ?? "")) patch.linkUrl = linkValue;
    if (!(await commitFields(fieldsForm))) return;
    if (patch.title !== undefined || patch.description !== undefined || patch.linkUrl !== undefined) {
      if (patch.description !== undefined) setDetail((d) => (d ? { ...d, description: desc! } : d));
      const ok = await save(patch, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { hasDescription: patch.description.trim().length > 0 } : {}),
        ...(patch.linkUrl !== undefined ? { linkUrl: patch.linkUrl || null } : {}),
      });
      if (!ok) return;
    }
    if (flushSubtasks.current && !(await flushSubtasks.current())) return;
    onClose();
  };

  /** Guarda los campos opcionales que difieren de lo guardado. `true` si no había nada que guardar o se guardó. */
  const commitFields = async (next: FieldsForm): Promise<boolean> => {
    const current = board.getTask(task.id) ?? task;
    const patch = fieldsPatch(next, fieldsFormOf(current), enabledFields);
    if (!Object.keys(patch).length) return true;
    const err = fieldsError(next, enabledFields, current.dueDate, t);
    if (err) {
      toast(err, "error");
      return false;
    }
    const ok = await save(patch as Parameters<typeof updateTask>[1], patch as Partial<BoardTask>);
    if (!ok) setFieldsForm(fieldsFormOf(board.getTask(task.id) ?? current));
    return ok;
  };

  /** ¿Algo guardado desde que se abrió el diálogo? (campos, subtareas, adjuntos y enlaces; no los comentarios). */
  const editedSinceOpen = (): boolean => {
    const t0 = initialTask.current;
    const now = board.getTask(task.id) ?? task;
    const keys = ["title", "kindId", "color", "linkUrl", "assigneeId", "dueDate", "deliverableId", "evergreen", "evergreenEvery", "recurrence", "recurrenceDay", "columnId", "cost", "costPaid", "estimatedHours", "actualHours", "priority", "client", "startDate"] as const;
    if (keys.some((k) => t0[k] !== now[k])) return true;
    if ((t0.blockedBy?.id ?? null) !== (now.blockedBy?.id ?? null)) return true;
    if ([...t0.labelIds].sort().join() !== [...now.labelIds].sort().join()) return true;
    const d0 = initialDetail.current;
    if (!d0 || !detail) return false;
    if (d0.description !== detail.description) return true;
    const sig = (d: TaskDetail) => [
      d.subtasks.map((s) => `${s.id}|${s.title}|${s.done}|${s.position}`).join("\n"),
      d.attachments.map((a) => a.id).join(),
      d.links.map((l) => l.id).join(),
    ].join("\n#\n");
    return sig(d0) !== sig(detail);
  };

  /**
   * Botón Cancelar: deshace lo que has hecho en la tarea desde que abriste el diálogo (una sola acción, deshacible) y
   * cierra; lo que hayan cambiado otras personas entretanto se queda. Lo que se esté escribiendo sin confirmar se
   * descarta al cerrar.
   */
  const cancelEdits = async () => {
    if (cancelling) return;
    setCancelling(true);
    uploadAbort.current.abort();
    uploadAbort.current = new AbortController(); // si Cancelar falla y el diálogo sigue abierto, se puede volver a subir
    try {
      await board.settle();
      if (!editedSinceOpen()) return onClose();
      const t0 = initialTask.current;
      const d0 = initialDetail.current;
      const res = await tracked(restoreTaskSnapshot(task.id, {
        title: t0.title, kindId: t0.kindId, color: t0.color as never, linkUrl: t0.linkUrl, assigneeId: t0.assigneeId, labelIds: t0.labelIds,
        dueDate: t0.dueDate, deliverableId: t0.deliverableId, evergreen: t0.evergreen, evergreenEvery: t0.evergreenEvery, recurrence: t0.recurrence, recurrenceDay: t0.recurrenceDay,
        columnId: t0.columnId, position: t0.position, blockedById: t0.blockedBy?.id ?? null, openedAt: d0?.loadedAt ?? openedAtLocal,
        cost: t0.cost, costPaid: t0.costPaid, estimatedHours: t0.estimatedHours, actualHours: t0.actualHours, priority: t0.priority, client: t0.client, startDate: t0.startDate,
        ...(d0 ? {
          description: d0.description,
          subtasks: d0.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, position: s.position })),
          attachmentIds: d0.attachments.map((a) => a.id),
          links: d0.links.map((l) => ({ id: l.id, kind: l.kind, title: l.title, url: l.url, shareStatus: l.shareStatus, shareFailed: l.shareFailed })),
        } : {}),
      }, d0 ? (ownTextVersion.current !== undefined ? ownTextVersion.current : d0.textVersion) : undefined));
      if (!res.ok) {
        toast(res.error, "error");
        // Otra persona cambió el texto: se recarga con sus cambios y el diálogo sigue abierto.
        await reload();
        return;
      }
      board.upsertTask(res.data.task);
      res.data.removed.forEach(board.removeTask);
      onClose();
      // Solo había cambios de otras personas (Cancelar no los toca): nada que descartar ni que deshacer.
      if (!res.data.changed) return;
      board.refresh();
      toast(t("Cambios descartados"), "undo", { label: t("Deshacer"), onClick: () => void undoLastChange() });
    } finally {
      setCancelling(false);
    }
  };

  /** Guardado optimista de campos de la tarjeta. */
  const save = (patch: Parameters<typeof updateTask>[1], optimistic: Partial<BoardTask>): Promise<boolean> => {
    const done = saveNow(patch, optimistic);
    if (patch.title !== undefined || patch.linkUrl !== undefined) textSaving.current = done.catch(() => false);
    return done;
  };
  const saveNow = async (patch: Parameters<typeof updateTask>[1], optimistic: Partial<BoardTask>): Promise<boolean> => {
    const before = board.getTask(task.id);
    board.patchTask(task.id, optimistic);
    // Título y descripción: se envía qué versión se estaba editando para no pisar a otra persona ni lo guardado desde otra
    // pestaña o dispositivo. Los de esta pestaña van de uno en uno y cada uno envía la versión que devolvió el anterior:
    // guardar el título y enseguida la descripción no es un conflicto.
    const editsText = patch.title !== undefined || patch.description !== undefined;
    let res: Awaited<ReturnType<typeof updateTask>>;
    if (editsText) {
      if (patch.title !== undefined) titleSaves.current++;
      const call = textSaves.current.then(() => tracked(updateTask(task.id, patch, textSince())));
      textSaves.current = call.then((r) => {
        if (patch.title !== undefined) titleSaves.current--;
        if (!r.ok) return;
        textVersion.current = ownTextVersion.current = r.data.textVersion;
        if (patch.title !== undefined) titleBase.current = r.data.title;
        if (patch.description !== undefined) descBase.current = patch.description;
        knownBase.current = true;
      }, () => {
        if (patch.title !== undefined) titleSaves.current--;
      });
      res = await call;
    } else res = await tracked(updateTask(task.id, patch, undefined));
    if (!res.ok) {
      if (before) board.upsertTask(before);
      // Sesión caducada o sin conexión: lo escrito se queda en el campo (y en el borrador local) para guardarlo luego; el
      // aviso de sesión lleva «Iniciar sesión» (ver Toast). Sin esto, el título volvía al guardado y se perdía con el borrador.
      const expired = isSessionExpiredMessage(res.error, t);
      const offline = isOfflineMessage(res.error, t);
      if ((expired || offline) && patch.title !== undefined && before) {
        setShownTitle(before.title);
        setTitle(patch.title);
      }
      if (patch.title !== undefined || patch.linkUrl !== undefined) textSaveFailed.current = true;
      // El texto que no se pudo guardar (p. ej. otra persona cambió la tarea a la vez y se recarga con lo suyo) no se
      // pierde: el aviso permite copiarlo para volver a aplicarlo.
      const rejected = [patch.title, patch.description].filter((x): x is string => !!x?.trim()).join("\n\n");
      // Sin conexión ya lo ha avisado board.track, y lo escrito sigue en su campo: no se repite el aviso.
      if (!offline) toast(res.error, "error", rejected && !expired ? { label: t("Copiar tu texto"), onClick: () => void copyText(rejected).then((ok) => ok && toast(t("Copiado al portapapeles"))) } : undefined);
      if (editsText && !expired && !offline) await reload();
      return false;
    }
    if (patch.title !== undefined || patch.linkUrl !== undefined) textSaveFailed.current = false;
    board.upsertTask(res.data);
    if (editsText) setDetail((d) => (d ? { ...d, textVersion: res.data.textVersion } : d));
    return true;
  };

  const changeColumn = async (columnId: string) => {
    if (columnId === task.columnId) return;
    if (!(await board.confirmLeaveReview([task.id], columnId))) return;
    const before = board.getTask(task.id)!;
    const last = Math.max(0, ...board.getTasks().filter((t) => t.columnId === columnId).map((t) => t.position));
    board.patchTask(task.id, { columnId, position: last + 1024, evergreen: false, evergreenEvery: 1, columnEnteredAt: new Date().toISOString() });
    const res = await tracked(moveTask(task.id, columnId, null, null));
    if (!res.ok) {
      board.upsertTask(before);
      return toast(res.error, "error");
    }
    board.patchTask(task.id, { position: res.data.position });
    res.data.spawned.forEach(board.upsertTask);
  };

  /** Cambio de la repetición; al activar semanal o mensual el día sale de la fecha límite (o de hoy). */
  const changeRecurrence = (recurrence: RecurrenceRule) => {
    const recurrenceDay = defaultRecurrenceDay(recurrence, task.dueDate, board.today);
    save({ recurrence, recurrenceDay }, { recurrence, recurrenceDay });
  };

  const upload = async (list: File[]) => {
    if (!list.length) return;
    // Sin tope de cantidad: solo el tamaño de cada archivo y lo que aún cabe en la tarea. Lo omitido se avisa de una vez.
    const used = (detail?.attachments ?? []).reduce((n, a) => n + a.size, 0);
    const { fileMaxMb, attachMaxMb } = board.project;
    const { accepted, skipped } = planUploads(list, { fileMaxBytes: fileMaxMb * 1024 * 1024, remainingBytes: attachMaxMb * 1024 * 1024 - used });
    if (skipped.length) toast(skippedMessage(t, locale, skipped, fileMaxMb), "error");
    if (skipped.some((s) => s.reason === "total")) setTotalRejected(true);
    if (!accepted.length) return;
    if (uploadAbort.current.signal.aborted) return;
    setUploading((n) => n + accepted.length);
    const batch = progressAgg.start();
    const res = await uploadBatch(task.id, accepted, {
      t,
      track: board.trackRaw,
      signal: uploadAbort.current.signal,
      onUploaded: (att) => {
        setDetail((d) => (d ? { ...d, attachments: [...d.attachments, att] } : d));
        // Con el diálogo ya cerrado nadie recalcula desde la lista: los contadores de la tarjeta se ponen aquí.
        board.patchTask(task.id, monotonicTotals(board.getTask(task.id), att.totals));
      },
      onProgress: batch.update,
    });
    setUploading((n) => n - accepted.length);
    batch.finish();
    if (res.totalRejected) setTotalRejected(true);
    const msg = batchErrorMessage(t, res.errors, res.notSent);
    if (msg) toast(msg, "error");
  };

  // Los contadores de la tarjeta (y el aviso «N / M MB en total») salen de la lista de adjuntos que se muestra, no de sumas
  // y restas sueltas: así subidas, borrados, deshacer, rehacer y «Cancelar» (todos acaban cambiando la lista) no los desajustan.
  // Solo al cambiar la lista (no en cada refresco), para no pisar lo que traiga el servidor sobre cambios de otras personas.
  const listedAttachments = detail?.attachments;
  useEffect(() => {
    if (listedAttachments) board.patchTask(task.id, attachmentTotalsOf(listedAttachments));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listedAttachments, task.id]);

  // Por nombre (orden natural, sin mayúsculas ni acentos), venga la lista de donde venga: carga, subida, deshacer o
  // recarga por cambios de otras personas. Las imágenes del visor siguen el mismo orden que las miniaturas.
  const sortedAttachments = sortByFileName(detail?.attachments ?? [], (a) => a.originalName, locale);
  const images = sortedAttachments.filter((a) => a.isImage);
  const files = sortedAttachments.filter((a) => !a.isImage);

  // Borrar un adjunto se puede deshacer (el fichero se conserva mientras exista la entrada), así que no se pregunta.
  const removeAttachment = async (id: string) => {
    const res = await board.track(deleteAttachment(id));
    if (!res.ok) return toast(res.error, "error");
    setDetail((d) => (d ? { ...d, attachments: d.attachments.filter((x) => x.id !== id) } : d));
    setTotalRejected(false);
    toast(t("Adjunto borrado"), "undo", { label: t("Deshacer"), onClick: () => void undoLastChange(res.data.undo.id) });
  };

  /** Deshace lo último hecho en esta tarea, o la entrada indicada (el botón «Deshacer» de los avisos) y recarga el detalle. */
  const undoLastChange = async (entryId?: string) => {
    // Con id (aviso «Adjunto borrado») se deshace exactamente esa entrada, no la última de la tarea.
    const res = await board.track(entryId ? undoEntry(entryId) : undoLast(board.project.id, task.id));
    if (!res.ok) return toast(res.error, "error");
    toast(t("Deshecho: {label}", { label: res.data.label }), "undo");
    await reloadRef.current();
  };

  const dropping = useFileDrop(upload);

  const remove = async () => {
    if (!(await confirm({ title: t("Borrar tarea"), message: t("¿Borrar definitivamente esta tarea y sus adjuntos?"), confirmLabel: t("Borrar"), danger: true }))) return;
    const res = await board.track(deleteTask(task.id));
    if (!res.ok) return toast(res.error, "error");
    board.removeTask(task.id);
    onClose();
    toast(t("Tarea borrada"));
  };

  const archive = async () => {
    const res = await board.track(archiveTask(task.id));
    if (!res.ok) return toast(res.error, "error");
    board.removeTask(task.id);
    res.data.spawned.forEach(board.upsertTask);
    onClose();
    toast(t("Tarea archivada"));
  };

  // Alt+S guarda y cierra (también escribiendo); Alt+A archiva (solo sin escribir). Actúan sobre la última versión de las funciones.
  const shortcutRef = useRef({ saveAndClose, archive });
  useEffect(() => {
    shortcutRef.current = { saveAndClose, archive };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  // Pegar archivos (Ctrl/⌘+V) en cualquier parte del detalle, también fuera de las cajas: una vez por pegado.
  usePasteFiles((files) => void upload(files), () => rootRef.current?.closest("[role=dialog]") ?? null);
  // Columna derecha (escritorio): si sus campos no caben, primero la paleta de color pasa a un botón con selector; si aun así
  // no caben, el diálogo entero pasa a tener un solo scroll (`flow`): las dos columnas crecen con su contenido y desplaza el
  // cuerpo del diálogo, con los botones de abajo fijos. Así la columna nunca tiene un scroll propio (antes salía una barra
  // inútil cuando sobraban 2-3 px). La medida no depende del modo (cuánto necesita la columna frente al alto útil del
  // cuerpo), así que no oscila. (El diálogo se pinta tras la hidratación: el elemento se guarda en estado para medir cuando existe.)
  const [asideEl, setAsideEl] = useState<HTMLElement | null>(null);
  const colorBox = useRef<HTMLDivElement>(null);
  const [compactColor, setCompactColor] = useState(false);
  const compactRef = useRef(false);
  const paletteH = useRef(0);
  const [flow, setFlow] = useState(false);
  const flowRef = useRef(false);
  useLayoutEffect(() => {
    const aside = asideEl;
    const scroller = aside?.querySelector<HTMLElement>("[data-aside-scroll]");
    const content = scroller?.firstElementChild;
    // Cuerpo del Modal (el que hace scroll en modo `flow`).
    const body = rootRef.current?.parentElement;
    if (!aside || !scroller || !content || !body) return;
    const setCompact = (v: boolean) => {
      if (v === compactRef.current) return;
      compactRef.current = v;
      setCompactColor(v);
    };
    const setFlowMode = (v: boolean) => {
      if (v === flowRef.current) return;
      flowRef.current = v;
      setFlow(v);
    };
    const check = () => {
      const box = colorBox.current;
      if (!box) return;
      // Por debajo de md la columna no tiene scroll propio (hace scroll el diálogo entero): siempre paleta abierta.
      if (!window.matchMedia("(min-width: 768px)").matches) {
        setCompact(false);
        setFlowMode(false);
        return;
      }
      const px = (v: string) => parseFloat(v) || 0;
      const bs = getComputedStyle(body);
      const as = getComputedStyle(aside);
      const ss = getComputedStyle(scroller);
      // Alto útil de la fila de columnas cuando el diálogo está a su alto máximo.
      const available = body.clientHeight - px(bs.paddingTop) - px(bs.paddingBottom);
      // Alto que necesita la columna para no desplazarse: su contenido, el relleno del contenedor con scroll y lo que lo
      // rodea en la columna (relleno, márgenes negativos, botones de abajo). Igual en los dos modos (el contenedor llena la columna).
      const around = aside.getBoundingClientRect().height - scroller.getBoundingClientRect().height + px(as.marginTop) + px(as.marginBottom);
      const needed = content.getBoundingClientRect().height + px(ss.paddingTop) + px(ss.paddingBottom) + around;
      const over = needed - available;
      // Con la paleta compacta se suma lo que ocuparía abierta (la última medida): solo se reabre si cabe entera.
      let compact: boolean;
      if (!compactRef.current) {
        paletteH.current = box.offsetHeight;
        compact = over > 0.01;
      } else {
        compact = over + (paletteH.current - box.offsetHeight) > 0.01;
      }
      if (compact !== compactRef.current) {
        // El cambio de la paleta cambia el alto del contenido: se vuelve a medir tras pintarla (ResizeObserver).
        setCompact(compact);
        if (!compact) setFlowMode(false);
        return;
      }
      setFlowMode(over > 0.01);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(body);
    ro.observe(aside);
    ro.observe(content);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [asideEl]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
      if (e.code !== "KeyS" && e.code !== "KeyA") return;
      // Con dos modales a la vez, responde el que contiene el foco (o este, si el foco está fuera de todos).
      const inside = rootRef.current?.closest("[role=dialog]")?.contains(e.target as Node);
      if (!inside && (e.target as HTMLElement | null)?.closest?.("[role=dialog]")) return;
      if (e.code === "KeyA" && isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.code === "KeyS") void shortcutRef.current.saveAndClose();
      else void shortcutRef.current.archive();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** @docs / @sheets / @slides: crea el archivo, lo abre en otra pestaña y lo enlaza. Debe llamarse dentro de un clic o tecla. */
  const createGoogle = async (kind: MentionCommand): Promise<TaskLinkInfo | null> => {
    if (!board.google.enabled) {
      toast(t("La integración con Google no está configurada en el servidor."), "error");
      return null;
    }
    if (!board.google.connected) {
      toast(t("Conecta tu cuenta de Google en «Mi perfil» para crear documentos."), "error");
      return null;
    }
    const res = await board.track(createAndOpenGoogleFile(task.id, kind, title.trim() || task.title, t));
    if (!res.ok) {
      toast(res.error, "error");
      return null;
    }
    setDetail((d) => (d ? { ...d, links: [...d.links, res.link] } : d));
    board.patchTask(task.id, (t) => ({ linkCount: t.linkCount + 1 }));
    const warning = shareWarning(res.link, t);
    if (warning) toast(warning, "error");
    else toast(kind === "GOOGLE_SHEET" ? t("Hoja de cálculo creada") : kind === "GOOGLE_SLIDES" ? t("Presentación creada") : t("Documento creado"));
    return res.link;
  };

  /** Cambio de tipo; con «Respuesta» también se guardan título y descripción predefinidos. */
  const changeKind = (kindId: string) => {
    const kind = board.kindById.get(kindId);
    const preset = detail && kind ? applyKindTemplate(kind, { title, description: detail.description }) : null;
    if (!preset) return save({ kindId }, { kindId });
    setTitle(preset.title);
    setDetail((d) => (d ? { ...d, description: preset.description } : d));
    setDescVersion((n) => n + 1);
    save(
      { kindId, title: preset.title, description: preset.description },
      { kindId, title: preset.title, hasDescription: preset.description.trim().length > 0 },
    );
  };

  // `next`: título recién escrito (el dictado sin campo visible lo cambia sin pasar por un estado ya renderizado).
  const commitTitle = (next?: string) => {
    const value = (next ?? title).trim();
    if (!value) return setTitle(task.title);
    // El campo queda con lo que se envía (sin espacios sobrantes): coincide con la tarjeta y, si el guardado falla, el
    // título guardado lo sustituye (ver `shownTitle`).
    if (value !== title) setTitle(value);
    if (value !== task.title) save({ title: value }, { title: value });
  };

  const commitLink = () => {
    // «example.com/x» o «www.example.com» se completan con https:// (como hará el servidor) y el campo lo muestra.
    const value = normalizeLinkUrl(link);
    if (value !== link) setLink(value);
    if (value === (task.linkUrl ?? "")) return;
    // Sin cambio optimista: si el servidor lo rechaza (p. ej. «javascript:» o algo que no es una dirección), el campo
    // conserva lo escrito para corregirlo.
    save({ linkUrl: value }, {});
  };


  // Archivar, Duplicar y Borrar solo con icono (con tooltip y atajo) para que, con Cancelar y Guardar, quepan en una línea
  // tanto en la columna lateral (~300 px) como en el pie móvil (360 px).
  const actionButtons = (
    <>
      <button className="btn-secondary px-2 py-1.5" onClick={archive} aria-label={t("Archivar")} title={`${t("Archivar")} (${sc("Alt+A")})`}><Archive size={15} /></button>
      <button className="btn-secondary px-2 py-1.5" onClick={() => void board.duplicateTask(task.id)} aria-label={t("Duplicar")} title={`${t("Duplicar")} (${sc("Alt+Shift+D")})`}><Copy size={15} /></button>
      <button className="btn-ghost px-2 py-1.5 text-red-600" onClick={remove} aria-label={t("Borrar")} title={t("Borrar")}><Trash2 size={15} /></button>
      <button className="btn-secondary ml-auto px-2 py-1.5" onClick={cancelEdits} disabled={cancelling} title={t("Descarta los cambios hechos desde que abriste la tarea y la cierra")}>{t("Cancelar")}</button>
      <button className="btn-primary px-3 py-1.5" onClick={saveAndClose} title={`${t("Guardar")} (${sc("Alt+S")})`}><Check size={15} /> {t("Guardar")}</button>
    </>
  );

  return (
    <Modal
      open
      onClose={requestClose}
      side={side}
      onAddSecond={onAddSecond}
      onAddSecondBulk={onAddSecondBulk}
      size="wide"
      placement="top"
      // Escritorio: el área central no hace scroll; cada columna lo hace por separado y los botones del pie nunca se mueven.
      // Con `flow` (la columna de campos no cabe) hace scroll el cuerpo entero, uno solo.
      bodyClassName={cn("md:flex md:flex-col", !flow && "md:overflow-hidden")}
      ariaLabel={mentionsToPlain(title).trim() || t("Detalle de la tarea")}
      // Móvil: pie siempre visible con Archivar, Borrar y Guardar.
      footer={
        mobile ? (
          <>
            {actionButtons}
          </>
        ) : undefined
      }
      // Escritorio: la altura se adapta al contenido (tope = viewport); con mucho contenido hace scroll la columna principal
      // (o, si la de campos no cabe, el cuerpo entero: ver `flow`).
      header={
        <div className="relative flex items-start gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <TitleField value={title} onChange={setTitle} onCommit={commitTitle} users={board.users} />
          {/* «Guardando… / Guardado»: aviso flotante sobre la línea inferior de la cabecera, a la derecha. Absoluto: no quita
              ancho al título ni tapa el micrófono, y su mitad inferior cae en el margen superior del cuerpo (sin texto). */}
          <span
            className={cn(
              "pointer-events-none absolute right-5 bottom-0 z-10 flex translate-y-1/2 items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] leading-4 shadow-sm transition-opacity duration-500 dark:bg-slate-900",
              saving > 0 ? "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400" : "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
              saving > 0 || justSaved ? "opacity-100" : "opacity-0",
            )}
            role="status"
            aria-live="polite"
            data-save-status
          >
            {saving > 0 ? (
              <><Loader2 size={12} className="animate-spin" /> {t("Guardando…")}</>
            ) : (
              <><Check size={12} /> {t("Guardado")}</>
            )}
          </span>
          {/* Móvil: el detalle ocupa la pantalla y tapa la cabecera; deshacer y rehacer (de esta tarea) van aquí. */}
          {mobile && <UndoButton projectId={board.project.id} inDialog className="shrink-0" />}
          {/* Fuera del orden de Tab (Título → descripción directo); Escape también cierra. */}
          {/* Sin quitar el foco al pulsarla: así el campo en edición sigue abierto mientras se pregunta (si hace falta) y se
              decide entonces si guardarlo o descartarlo, igual que con Escape, clic fuera o atrás. */}
          <button type="button" className="btn-icon" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => void requestClose()} aria-label={t("Cerrar")}>
            <X size={18} />
          </button>
        </div>
      }
    >
      <div ref={rootRef} className={cn("grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]", flow ? "md:flex-none" : "md:min-h-0 md:flex-[1_1_auto] md:grid-rows-[minmax(0,1fr)]")}>
        {/* Margen negativo con relleno igual: deja sitio al anillo de foco (3 px + 2 de separación) que el scroll recortaría. */}
        <div className={cn("min-w-0 space-y-6 md:-m-2 md:p-2", !flow && "md:overflow-y-auto md:[--sticky-top:-0.5rem]")}>
          <TaskViewers taskId={task.id} />
          <DescriptionEditor
            key={detail ? `loaded-${descVersion}` : "loading"}
            users={board.users}
            onGoogle={createGoogle}
            initial={detail?.description ?? null}
            remote={descRemote}
            // El borrador recuperado solo se aplica la primera vez que se carga la tarea.
            draft={detail && !draftUsed && descVersion === 0 ? draft?.description : undefined}
            liveRef={descLive}
            dirtyRef={descDirtyCheck}
            onDraftChange={(md) => {
              descDraft.current = md;
              if (md !== null && !draftUsed) setDraftUsed(true);
            }}
            onSave={async (description) => {
              const previous = detail?.description ?? "";
              setDetail((d) => (d ? { ...d, description } : d));
              const ok = await save({ description }, { hasDescription: description.trim().length > 0 });
              // Si no se guardó y nadie lo recargó (sin red), el detalle vuelve a lo guardado: no se da por guardado.
              if (!ok) setDetail((d) => (d && d.description === description ? { ...d, description: previous } : d));
              return ok;
            }}
            onClear={async () => {
              setDetail((d) => (d ? { ...d, description: "" } : d));
              // Pasa por el guardado normal: queda en el historial y se deshace como cualquier cambio.
              if (await save({ description: "" }, { hasDescription: false })) toast(t("Descripción borrada"), "undo", { label: t("Deshacer"), onClick: () => void undoLastChange() });
            }}
          />
          <Subtasks taskId={task.id} detail={detail} setDetail={setDetail} flushRef={flushSubtasks} draftRef={subtaskDraftPending} blurHeld={blurHeld} onUndo={(id) => void undoLastChange(id)} />
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {detail?.attachments.length ? t("Capturas y adjuntos ({n})", { n: detail.attachments.length }) : t("Capturas y adjuntos")}
              </h3>
              <div className="flex items-center gap-1">
                <label className="btn-secondary cursor-pointer py-1 text-xs has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus sm:hidden">
                  <Camera size={15} /> {t("Cámara")}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { upload(filesFrom(e.target.files)); e.target.value = ""; }} />
                </label>
                <label className="btn-secondary cursor-pointer py-1 text-xs has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
                  <ImagePlus size={15} /> {t("Añadir")}
                  <input type="file" multiple className="sr-only" onChange={(e) => { upload(filesFrom(e.target.files)); e.target.value = ""; }} />
                </label>
              </div>
            </div>
            <AttachLimitHint
              className="mb-2 max-sm:hidden" usedBytes={task.attachBytes} limitMb={board.project.attachMaxMb} fileMaxMb={board.project.fileMaxMb} rejected={totalRejected}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((a, i) => (
                <div key={a.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <button type="button" onClick={() => setLightbox(i)} className="block w-full" aria-label={t("Ver {name}", { name: a.originalName })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/attachments/${a.id}?thumb=1`} alt={a.originalName} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                  </button>
                  <button
                    type="button"
                    className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
                    aria-label={t("Borrar adjunto")}
                    onClick={() => removeAttachment(a.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {uploading > 0 && !progress && (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 dark:border-slate-700">
                  <Loader2 size={16} className="mr-1.5 animate-spin" /> {t("Subiendo…")}
                </div>
              )}
            </div>
            {progress && <UploadProgress progress={progress} className="mt-2" />}
            {files.length > 0 && (
              <ul className={cn("space-y-1.5", images.length > 0 && "mt-2")}>
                {files.map((a) => {
                  const Icon = fileIcon(a);
                  return (
                    <li key={a.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
                      <Icon size={18} className="shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate" title={a.originalName}>{a.originalName}</span>
                      <span className="shrink-0 text-xs text-slate-500">{formatBytes(a.size, locale)}</span>
                      <a href={`/api/attachments/${a.id}?download=1`} download={a.originalName} className="btn-icon h-7 w-7 shrink-0" aria-label={t("Descargar {name}", { name: a.originalName })} title={t("Descargar")}>
                        <Download size={15} />
                      </a>
                      <button type="button" className="btn-icon h-7 w-7 shrink-0 text-red-600" aria-label={t("Borrar adjunto")} onClick={() => removeAttachment(a.id)}>
                        <Trash2 size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {detail && detail.attachments.length === 0 && uploading === 0 && (
              <p className="text-xs text-slate-400">{t("Sin adjuntos.")}</p>
            )}
          </section>
          {/* Sin Google configurado no se pueden crear documentos: la sección solo sale si la tarea ya tiene alguno enlazado. */}
          {(board.google.enabled || (detail?.links.length ?? 0) > 0) && (
            <GoogleLinks taskId={task.id} detail={detail} setDetail={setDetail} onCreate={createGoogle} canCreate={board.google.enabled} />
          )}
          <Comments taskId={task.id} detail={detail} setDetail={setDetail} users={board.users} onGoogle={createGoogle} editDirtyRef={commentEditDirty} />
          <TaskHistory taskId={task.id} />
        </div>

        {/* El margen negativo con relleno igual deja sitio al anillo de foco (3 px + 2 de separación) que el scroll recortaría. */}
        <aside ref={setAsideEl} className="flex flex-col text-sm md:-m-2 md:min-h-0 md:p-2">
          {/* Relleno de 6 px abajo: el anillo de foco del último botón (3 px + 2 de separación) no se recorta ni crea scroll. */}
          <div data-aside-scroll className={cn("md:-mx-2 md:-mt-2 md:min-h-0 md:flex-1 md:px-2 md:pt-2 md:pb-1.5", !flow && "md:overflow-y-auto")}>
          <div className="flex flex-col gap-4 md:gap-2">
          <Field label={t("Columna")}>
            {(id) => (
              <select id={id} className="input min-w-0 truncate md:py-1" title={board.columns.find((c) => c.id === task.columnId)?.name} value={task.columnId} onChange={(e) => changeColumn(e.target.value)}>
                {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>
          {board.columns.find((c) => c.id === task.columnId)?.role === "NEXT_RELEASE" && (
            <label className="flex items-center gap-2" title={t("Se queda en la columna de la release al desplegar y se incluye siempre en el texto")}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={task.evergreen}
                onChange={(e) => save({ evergreen: e.target.checked }, e.target.checked ? { evergreen: true } : { evergreen: false, evergreenEvery: 1 })}
              />
              {t("Fija en la release (evergreen)")}
            </label>
          )}
          <Field label={t("Tipo")}>
            <TypeSelector kinds={board.kinds} value={task.kindId} onChange={changeKind} />
          </Field>
          <Field label={t("Asignada a (opcional)")}>
            {(id) => (
              <select
                id={id}
                className="input min-w-0 truncate md:py-1"
                title={board.users.find((u) => u.id === task.assigneeId)?.name}
                value={task.assigneeId ?? ""}
                onChange={(e) => save({ assigneeId: e.target.value || null }, { assigneeId: e.target.value || null })}
              >
                <option value="">{t("Sin asignar")}</option>
                {board.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </Field>
          <Field label={t("Fecha límite")}>
            {(id) => (
              <div className="flex gap-1">
                <input
                  id={id}
                  type="date"
                  className={cn(
                    "input md:py-1",
                    dueStatus(task.dueDate, board.columns.find((c) => c.id === task.columnId)?.isDone ?? false, board.today) === "overdue" &&
                      "border-red-400 text-red-700 dark:text-red-300",
                  )}
                  value={task.dueDate ?? ""}
                  onChange={(e) => {
                    // Al teclear el año, Chrome emite 0002, 0020… : solo se guarda una fecha completa y válida.
                    const v = e.target.value;
                    if (v === "" || v.slice(0, 4) >= "1900") save({ dueDate: v || null }, { dueDate: v || null });
                  }}
                />
                {task.dueDate && (
                  <button className="btn-icon h-9 w-9 shrink-0 md:h-7.5 md:w-7.5" onClick={() => save({ dueDate: null }, { dueDate: null })} aria-label={t("Quitar fecha límite")}>
                    <X size={15} />
                  </button>
                )}
              </div>
            )}
          </Field>
          <TaskFieldsGroup
            enabled={enabledFields}
            value={fieldsForm}
            onChange={(p) => setFieldsForm((f) => ({ ...f, ...p }))}
            onCommit={(next) => void commitFields(next)}
            dueDate={task.dueDate}
            clients={boardClients(board.getTasks())}
          />
          <Field label={t("Repetir")}>
            {(id) => (
              <>
                <RecurrencePicker
                  id={id}
                  rule={task.recurrence}
                  day={task.recurrenceDay}
                  onRule={changeRecurrence}
                  onDay={(d) => save({ recurrenceDay: d }, { recurrenceDay: d })}
                  selectClassName="md:py-1"
                />
                {task.recurrence !== "NONE" && (
                  <p className="mt-1 text-xs text-slate-500">{t("Al terminarla o archivarla se crea la siguiente, sin las subtareas marcadas.")}</p>
                )}
              </>
            )}
          </Field>
          <Field label={t("Entregable")}>
            {(id) => (
              <select
                id={id}
                className="input min-w-0 truncate md:py-1"
                title={board.deliverables.find((d) => d.id === task.deliverableId)?.name}
                value={task.deliverableId ?? ""}
                onChange={(e) => save({ deliverableId: e.target.value || null }, { deliverableId: e.target.value || null })}
              >
                <option value="">{t("Sin entregable")}</option>
                {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </Field>
          <Field label={t("Bloqueada por (opcional)")}>
            <BlockerPicker task={task} onChange={(blocker) => save({ blockedById: blocker?.id ?? null }, { blockedBy: blocker })} />
          </Field>
          <Field label={t("Color")}>
            <div ref={colorBox}>
              {compactColor ? (
                <ColorPopover value={task.color} onChange={(color) => save({ color: color as never }, { color })} />
              ) : (
                // Escritorio: dos filas equilibradas (8 + 7) de swatches algo más pequeños para ocupar menos alto.
                <div className="md:[&_button]:h-6 md:[&_button]:w-6">
                  <ColorPicker value={task.color} onChange={(color) => save({ color: color as never }, { color })} balancedRowsMd />
                </div>
              )}
            </div>
          </Field>
          <Field label={t("Etiquetas")}>
            <div className="flex flex-wrap gap-1.5 md:gap-1">
              {board.labels.map((l) => {
                const on = task.labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      const labelIds = on ? task.labelIds.filter((x) => x !== l.id) : [...task.labelIds, l.id];
                      save({ labelIds }, { labelIds });
                    }}
                    className={cn("rounded px-2 py-0.5 text-xs font-medium", on ? "text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                    style={on ? { backgroundColor: l.color, color: onColor(l.color), boxShadow: isWhite(l.color) ? "inset 0 0 0 1px rgb(0 0 0 / 0.2)" : undefined } : undefined}
                    aria-pressed={on}
                  >
                    {l.name}
                  </button>
                );
              })}
              <Link href={`/p/${board.project.id}/settings?tab=tablero#labels`} className="px-1 py-0.5 text-xs text-brand-600 dark:text-brand-300 hover:underline">
                {t("Gestionar")}
              </Link>
            </div>
          </Field>
          <Field label={t("Enlace externo")}>
            {(id) => (
              <div className="flex gap-1">
                <input
                  id={id}
                  className="input md:py-1"
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onBlur={commitLink}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                {task.linkUrl && (
                  <a href={task.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-icon h-9 w-9 shrink-0 md:h-7.5 md:w-7.5" aria-label={t("Abrir enlace")}>
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            )}
          </Field>
          {detail && (
            <p className="text-xs text-slate-500">
              {detail.createdByName
                ? t("Creada por {name} el {date} a las {time}", { name: detail.createdByName, date: formatDate(detail.createdAt, "dateNumeric", locale), time: formatDate(detail.createdAt, "timeHm", locale) })
                : t("Creada el {date} a las {time}", { date: formatDate(detail.createdAt, "dateNumeric", locale), time: formatDate(detail.createdAt, "timeHm", locale) })}
            </p>
          )}
          <FollowToggle taskId={task.id} following={detail?.following} />
          </div>
          </div>
          {/* En móvil estos botones van en el pie fijo, junto a Guardar; en escritorio, fijos bajo la columna (no se desplazan). */}
          <div
            className={cn(
              "mt-auto flex flex-nowrap items-center gap-2 border-t border-slate-200 pt-4 max-md:hidden md:mt-0 md:shrink-0 md:gap-1 md:pt-2.5 dark:border-slate-800",
              // Un solo scroll: los botones se quedan a la vista, pegados abajo. `-bottom-4` compensa el relleno inferior del
              // cuerpo (el pegado cuenta desde su borde interior) y la sombra sólida tapa esa franja sin cambiar el alto del bloque.
              flow && "md:sticky md:-bottom-4 md:z-10 md:bg-white md:shadow-[0_1rem_0_0_var(--color-white)] dark:md:bg-slate-900 dark:md:shadow-[0_1rem_0_0_var(--color-slate-900)]",
            )}
          >
            {actionButtons}
          </div>
        </aside>
      </div>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-brand-500/15 p-4 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-lg font-semibold text-brand-700 shadow-xl dark:bg-slate-900/90 dark:text-brand-300">
            {t("Suelta para adjuntar")}
          </div>
        </div>
      )}
      {lightbox !== null && images.length > 0 && (
        <Lightbox
          images={images.map((a) => ({
            src: `/api/attachments/${a.id}`,
            alt: a.originalName,
            downloadHref: `/api/attachments/${a.id}?download=1`,
          }))}
          index={Math.min(lightbox, images.length - 1)}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </Modal>
  );
}

/** Selector de color compacto: un botón con el color actual que abre la paleta en un panel flotante (elegir uno lo cierra). */
function ColorPopover({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  const t = useT();
  const name = value === null ? t("Sin color") : COLOR_NAME[value.toLowerCase()] ? t(COLOR_NAME[value.toLowerCase()]!) : value;
  return (
    <Popover
      label={t("Color")}
      panelClassName="w-[19rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
      trigger={({ open, props }) => (
        <button type="button" {...props} aria-label={`${t("Color")}: ${name}`} className={cn("input flex items-center gap-2 text-left md:py-1", open && "border-focus")}>
          <span
            className={cn("h-4 w-4 shrink-0 rounded-full", value === null ? "border-2 border-dashed border-slate-300 dark:border-slate-600" : swatchBorder(value))}
            style={value ? { backgroundColor: value } : undefined}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden />
        </button>
      )}
    >
      {({ close }) => (
        <ColorPicker
          value={value}
          onChange={(c) => {
            onChange(c);
            close();
          }}
          balancedRowsMd
        />
      )}
    </Popover>
  );
}

/**
 * Campo lateral del detalle con su etiqueta. Con una función como contenido, la etiqueta es un <label> del control que
 * recibe el id (un lector de pantalla lo anuncia con su nombre: antes los desplegables no tenían ninguno y «Columna» se
 * anunciaba con el de la columna elegida); si no, el bloque es un grupo con la etiqueta como nombre.
 */
function Field({ label, children }: { label: string; children: React.ReactNode | ((id: string) => React.ReactNode) }) {
  const id = useId();
  if (typeof children === "function") {
    return (
      <div>
        <label className="label md:mb-0.5" htmlFor={id}>{label}</label>
        {children(id)}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <div className="label md:mb-0.5" id={`${id}-label`}>{label}</div>
      {children}
    </div>
  );
}

/**
 * Selector de tipo como grupo de radio: un solo punto de Tab (en el tipo elegido); las flechas mueven
 * el foco entre tipos (de la última a la primera y al revés) y Espacio/Intro elige el tipo enfocado.
 */
export function TypeSelector({ kinds, value, onChange }: { kinds: KindOption[]; value: string; onChange: (kindId: string) => void }) {
  const t = useT();
  const [focused, setFocused] = useState<string | null>(null);
  // Punto de Tab: el tipo con el foco, si no el elegido, si no el primero.
  const tabStop = kinds.some((k) => k.id === focused) ? focused : kinds.some((k) => k.id === value) ? value : kinds[0]?.id;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !buttons.length) return;
    e.preventDefault();
    const next = buttons[(index + step + buttons.length) % buttons.length]!;
    setFocused(next.dataset.kind ?? null);
    next.focus();
  };
  return (
    <div role="radiogroup" aria-label={t("Tipo")} className="flex flex-wrap gap-1" onKeyDown={onKeyDown}>
      {kinds.map((k) => (
        <button
          key={k.id}
          type="button"
          role="radio"
          data-kind={k.id}
          tabIndex={k.id === tabStop ? 0 : -1}
          onClick={() => onChange(k.id)}
          onFocus={() => setFocused(k.id)}
          className={cn("badge cursor-pointer px-2 py-1 text-xs", value === k.id ? "kind-badge" : "bg-transparent text-slate-500 ring-slate-300 dark:ring-slate-700")}
          style={value === k.id ? kindBadgeStyle(k.color) : undefined}
          aria-checked={value === k.id}
        >
          {k.name}
        </button>
      ))}
    </div>
  );
}

function DescriptionEditor({ initial, remote, draft, onSave, onClear, users, onGoogle, onDraftChange, liveRef, dirtyRef }: {
  initial: string | null;
  /** Cambia cuando `initial` es una descripción nueva guardada desde fuera (otra persona u otra pestaña). */
  remote?: number;
  /** Texto recuperado de un borrador: el editor empieza editándolo. */
  draft?: string;
  /** Guarda; con `false` (no se guardó) el editor vuelve a abrirse con el texto escrito. */
  onSave: (v: string) => Promise<boolean>;
  /** Borra la descripción guardada (se guarda como cualquier cambio, así que se puede deshacer). */
  onClear: () => void;
  users: UserOption[];
  onGoogle: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
  /** Borrador actual en Markdown mientras se edita (con retardo); null al no estar editando. */
  onDraftChange?: (markdown: string | null) => void;
  /** Texto en edición al instante (null si no se edita): lo lee el botón Guardar. */
  liveRef?: React.MutableRefObject<string | null>;
  /** ¿Hay cambios de la persona sin guardar? (para preguntar antes de cerrar el detalle). */
  dirtyRef?: React.MutableRefObject<(() => boolean) | null>;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { editorMode } = useBoard();
  const [value, setValue] = useState(draft ?? initial ?? "");
  const [editing, setEditingState] = useState(draft !== undefined);
  // Cambios sin guardar = lo escrito difiere de `baseline`. Al abrir, el editor con barra puede reescribir el Markdown
  // (p. ej. «* a» → «- a») sin que nadie toque nada: lo que emite antes de la primera tecla, pegado, arrastre o clic en
  // él pasa a ser la referencia, para no preguntar al cerrar si no se ha cambiado nada. Un borrador recuperado ya cuenta como cambio.
  const touched = useRef(draft !== undefined && draft !== initial);
  const baseline = useRef(initial ?? "");
  const setEditing = (on: boolean) => {
    if (on && !editing) {
      touched.current = false;
      baseline.current = initial ?? "";
    }
    setEditingState(on);
  };
  const onEditorChange = (v: string) => {
    if (!touched.current) baseline.current = v;
    setValue(v);
  };
  const dirtyLatest = useRef<() => boolean>(() => false);
  useEffect(() => {
    dirtyLatest.current = () => editing && value !== baseline.current;
  });
  useEffect(() => {
    if (!dirtyRef) return;
    dirtyRef.current = () => dirtyLatest.current();
    return () => {
      dirtyRef.current = null;
    };
  }, [dirtyRef]);
  const touch = () => {
    touched.current = true;
  };
  // Descripción nueva guardada desde fuera: se muestra, también en el editor abierto si no hay cambios propios (que no se
  // pisan: al guardarlos, el servidor avisa del conflicto). Sin remontar, para no cerrar el editor ni perder el foco.
  const appliedRemote = useRef(remote);
  useEffect(() => {
    if (remote === appliedRemote.current) return;
    appliedRemote.current = remote;
    if (initial === null || (editing && value !== baseline.current)) return;
    baseline.current = initial;
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando llega un cambio de fuera
  }, [remote]);
  useEffect(() => {
    if (liveRef) liveRef.current = editing ? value : null;
  }, [liveRef, editing, value]);
  useEffect(() => () => {
    if (liveRef) liveRef.current = null;
  }, [liveRef]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const draftCb = useRef(onDraftChange);
  useEffect(() => {
    draftCb.current = onDraftChange;
  });
  useEffect(() => {
    if (!editing) {
      draftCb.current?.(null);
      return;
    }
    const timer = setTimeout(() => draftCb.current?.(value), 300);
    return () => clearTimeout(timer);
  }, [editing, value]);
  useEffect(() => () => draftCb.current?.(null), []);
  // Al cerrar el editor (Escape, Cancelar, Guardar) su campo desaparece y el foco se iba a <body>: con el teclado había
  // que volver a buscar el sitio. Pasa al botón «Editar» de la descripción (no a «Añade una descripción…», que al
  // recibir el foco con el teclado vuelve a abrir el editor).
  const section = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    // Si la persona ya ha puesto el foco en otro sitio (clic en otro campo), se queda allí.
    if (active && active !== document.body && !section.current?.contains(active)) return;
    editButton.current?.focus();
  }, [editing]);
  const closeEditor = () => {
    refocus.current = true;
    setEditing(false);
  };

  if (initial === null) {
    return <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />;
  }

  const finish = () => {
    // Pasarse del límite no se guarda: se queda editando con el aviso del recuento.
    if (value.length > MAX_DESCRIPTION) return toast(descriptionTooLong(t, locale, MAX_DESCRIPTION), "error");
    closeEditor();
    // Si falla y el editor sigue montado (no se recargó la tarea), se reabre con lo escrito para no perderlo.
    if (value !== initial) void onSave(value).then((ok) => !ok && setEditing(true));
  };
  const cancel = () => {
    setValue(initial);
    closeEditor();
  };
  // Escape en el editor descarta la edición: con cambios, se pregunta antes (el botón «Cancelar» no pregunta).
  const escapeCancel = async () => {
    if (value === initial || value === baseline.current) return cancel();
    const ok = await confirm({
      title: t("Cambios sin guardar"),
      message: t("¿Descartar los cambios de la descripción?"),
      confirmLabel: t("Descartar cambios"),
      cancelLabel: t("Seguir editando"),
      danger: true,
    });
    if (ok) cancel();
  };

  const clear = () => {
    setEditing(false);
    setValue("");
    if (initial.trim()) onClear();
  };

  return (
    <section ref={section}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Descripción")}</h3>
        <DescriptionTools value={value} onClear={clear} className="ml-auto" max={MAX_DESCRIPTION} />
        {!editing && (
          // Fuera del orden de Tab (Título → descripción directo): al tabular, la propia zona de la descripción entra en edición.
          <button ref={editButton} className="btn-ghost py-1 text-xs" tabIndex={-1} onClick={() => { setEditing(true); requestAnimationFrame(() => ref.current?.focus()); }}>
            {t("Editar")}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {/* Lo que hace la persona en el editor (teclas, pegar, soltar, clics en la barra) marca el texto como tocado. */}
          <div onKeyDownCapture={touch} onPasteCapture={touch} onDropCapture={touch} onMouseDownCapture={touch} onTouchStartCapture={touch} onBeforeInputCapture={touch}>
          <DescriptionField
            mode={editorMode}
            textareaRef={ref}
            value={value}
            onValueChange={onEditorChange}
            users={users}
            autoFocus
            onCommand={async (kind) => {
              touch();
              const link = await onGoogle(kind);
              if (link) setValue((v) => `${v.trimEnd()}\n\n${kind === "GOOGLE_SHEET" ? t("Hoja") : kind === "GOOGLE_SLIDES" ? t("Presentación") : t("Documento")}: [${link.title.replace(/[\[\]]/g, "")}](${link.url})\n`);
            }}
            placeholder={t("Markdown · @persona · @docs / @sheets / @slides")}
            onCancel={() => void escapeCancel()}
            onSubmit={finish}
          />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={finish}>{t("Guardar")}</button>
            <button className="btn-ghost py-1.5" onClick={cancel}>{t("Cancelar")}</button>
            <span className="ml-auto self-center text-xs text-slate-400 max-sm:hidden">{t("Ctrl+Enter para guardar")}</span>
          </div>
        </div>
      ) : value.trim() ? (
        <div
          className="cursor-text rounded-lg p-1 hover:bg-slate-50 dark:hover:bg-slate-800/50"
          onDoubleClick={() => setEditing(true)}
          tabIndex={0}
          role="group"
          aria-label={t("Descripción")}
          // Solo con el teclado (Tab): el clic con el ratón no debe abrir la edición, y un enlace del texto conserva su foco.
          onFocus={(e) => {
            if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && e.key === "Enter") setEditing(true);
          }}
        >
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <button
          className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-left text-sm text-slate-400 hover:border-brand-500 dark:border-slate-700"
          onClick={() => setEditing(true)}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setEditing(true);
          }}
        >
          {t("Añade una descripción…")}
        </button>
      )}
    </section>
  );
}

function Subtasks({ taskId, detail, setDetail, flushRef, draftRef, blurHeld, onUndo }: {
  taskId: string;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** ¿Hay una subtarea a medio escribir o un renombrado sin confirmar? (para avisar antes de cerrar). */
  draftRef?: React.MutableRefObject<(() => boolean) | null>;
  /** `true` mientras se pregunta al cerrar el detalle (o tras descartar): salir del campo no guarda el renombrado. */
  blurHeld?: () => boolean;
  /** Deshace la entrada indicada (el «Deshacer» del aviso tras pegar varias subtareas) y recarga. */
  onUndo?: (entryId?: string) => void;
}) {
  const t = useT();
  const board = useBoard();
  const toast = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const subtasks = detail?.subtasks;
  const list = subtasks ?? [];
  const done = list.filter((s) => s.done).length;
  const { patchTask } = board;

  // El contador de la tarjeta se deriva siempre de la lista actual.
  useEffect(() => {
    if (subtasks) patchTask(taskId, { subtaskTotal: subtasks.length, subtaskDone: subtasks.filter((s) => s.done).length });
  }, [subtasks, taskId, patchTask]);

  // Actualizaciones funcionales: varias acciones seguidas no se pisan entre sí.
  const update = (fn: (list: SubtaskInfo[]) => SubtaskInfo[]) =>
    setDetail((d) => (d ? { ...d, subtasks: fn(d.subtasks) } : d));

  const addNow = async (): Promise<boolean> => {
    const title = newTitle.trim();
    if (!title) return true;
    setNewTitle("");
    const res = await board.track(addSubtask(taskId, title));
    if (!res.ok) {
      setNewTitle((cur) => cur || title);
      toast(res.error, "error");
      return false;
    }
    update((l) => [...l, res.data]);
    return true;
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void addNow();
  };

  // Pegar varias líneas crea una subtarea por línea no vacía (sin viñetas ni casillas), todas en una acción que se
  // deshace de una vez. Una sola línea se pega normal en el campo.
  const pasteMany = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = /[\r\n]/.test(text) && !e.clipboardData.files.length ? subtaskLines(text, MAX_TITLE) : [];
    if (lines.length < 2) return pasteAsOneLine(e, setNewTitle);
    e.preventDefault();
    void addMany(lines);
  };
  const addMany = async (titles: string[]) => {
    const room = MAX_SUBTASKS - list.length;
    if (room <= 0) return toast(t("Una tarea no puede tener más de 100 subtareas."), "error");
    // Se envían como mucho MAX_SUBTASKS; las que se quedan fuera cuentan en el aviso de las que no caben.
    const { send, dropped } = subtaskBatch(titles, MAX_SUBTASKS);
    const res = await board.track(addSubtasks(taskId, send));
    if (!res.ok) return toast(res.error, "error");
    const { created, undo } = res.data;
    const skipped = res.data.skipped + dropped;
    update((l) => [...l, ...created.filter((c) => !l.some((x) => x.id === c.id))]);
    if (skipped) toast(subtasksDidNotFit(t, created.length, skipped, MAX_SUBTASKS), "error");
    else toast(created.length === 1 ? t("1 subtarea añadida") : t("{n} subtareas añadidas", { n: created.length }), "undo", onUndo ? { label: t("Deshacer"), onClick: () => onUndo(undo.id) } : undefined);
  };

  const setDone = (id: string, value: boolean) => update((l) => l.map((x) => (x.id === id ? { ...x, done: value } : x)));

  const toggle = async (s: SubtaskInfo) => {
    setDone(s.id, !s.done);
    const res = await board.track(updateSubtask(s.id, { done: !s.done }));
    if (!res.ok) {
      setDone(s.id, s.done);
      toast(res.error, "error");
    }
  };

  // Renombrado en curso (id + texto escrito): Guardar lo confirma aunque no se haya pulsado Enter.
  const renameDraft = useRef<{ id: string; title: string } | null>(null);
  const rename = async (s: SubtaskInfo, title: string): Promise<boolean> => {
    setEditingId(null);
    renameDraft.current = null;
    if (!title || title === s.title) return true;
    update((l) => l.map((x) => (x.id === s.id ? { ...x, title } : x)));
    const res = await board.track(updateSubtask(s.id, { title }));
    if (!res.ok) {
      update((l) => l.map((x) => (x.id === s.id ? { ...x, title: s.title } : x)));
      toast(res.error, "error");
      return false;
    }
    return true;
  };
  const flushLatest = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => {
    flushLatest.current = async () => {
      const pending = renameDraft.current;
      const target = pending ? list.find((x) => x.id === pending.id) : undefined;
      if (pending && target && !(await rename(target, pending.title.trim()))) return false;
      return addNow();
    };
  });
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => flushLatest.current();
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);
  const pendingLatest = useRef<() => boolean>(() => false);
  useEffect(() => {
    pendingLatest.current = () => {
      const pending = renameDraft.current;
      const target = pending ? list.find((x) => x.id === pending.id) : undefined;
      return !!newTitle.trim() || (!!pending && !!target && !!pending.title.trim() && pending.title.trim() !== target.title);
    };
  });
  useEffect(() => {
    if (!draftRef) return;
    draftRef.current = () => pendingLatest.current();
    return () => {
      draftRef.current = null;
    };
  }, [draftRef]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Avisos del lector de pantalla al arrastrar: título y posición de la subtarea (no su id).
  const dragAccessibility = subtaskDragA11y(
    t,
    (id) => list.find((x) => x.id === id)?.title ?? t("Subtareas"),
    (id) => {
      const n = list.findIndex((x) => x.id === id);
      return n < 0 ? null : { n: n + 1, total: list.length };
    },
  );

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = list.findIndex((x) => x.id === active.id);
    const to = list.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    const before = list;
    const moved = arrayMove(list, from, to);
    const id = String(active.id);
    const prevId = moved[to - 1]?.id ?? null;
    const nextId = moved[to + 1]?.id ?? null;
    update(() => moved);
    const res = await board.track(reorderSubtask(id, prevId, nextId));
    if (!res.ok) {
      update(() => before);
      return toast(res.error, "error");
    }
    update((l) => l.map((x) => (x.id === id ? { ...x, position: res.data.position } : x)));
  };

  const remove = async (s: SubtaskInfo) => {
    update((l) => l.filter((x) => x.id !== s.id));
    const res = await board.track(deleteSubtask(s.id));
    if (!res.ok) {
      update((l) => [...l, s].sort((a, b) => a.position - b.position));
      toast(res.error, "error");
    }
  };

  return (
    <section>
      {/* Barra de progreso hasta el borde derecho: se llena según la proporción de subtareas hechas (no su orden). */}
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-semibold">{t("Subtareas")}</h3>
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label={t("Progreso de las subtareas")}
          aria-valuemin={0}
          aria-valuemax={list.length}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-progress shadow-[0_0_6px] shadow-progress/60 transition-[width] duration-300"
            style={{ width: list.length ? `${(done / list.length) * 100}%` : "0%" }}
          />
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={dragAccessibility} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {list.map((s) => (
              <SubtaskRow key={s.id} s={s} editing={editingId === s.id} blurHeld={blurHeld} onEdit={() => setEditingId(s.id)} onRename={(v) => void rename(s, v)} onDraft={(v) => (renameDraft.current = { id: s.id, title: v })} onToggle={() => toggle(s)} onRemove={() => remove(s)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <form onSubmit={add} className="mt-1 flex gap-2">
        <input className="input py-1.5" placeholder={t("Añadir subtarea…")} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onPaste={pasteMany} maxLength={MAX_TITLE} disabled={!detail} />
        <button className="btn-secondary py-1.5" disabled={!newTitle.trim()} aria-label={t("Añadir subtarea")}><Plus size={15} /></button>
      </form>
    </section>
  );
}

/** Fila ordenable: agarre de seis puntos, título editable (doble clic, Enter/F2 o lápiz) y borrado. */
function SubtaskRow({ s, editing, blurHeld, onEdit, onRename, onDraft, onToggle, onRemove }: {
  s: SubtaskInfo; editing: boolean; blurHeld?: () => boolean; onEdit: () => void; onRename: (title: string) => void; onDraft: (title: string) => void; onToggle: () => void; onRemove: () => void;
}) {
  const t = useT();
  // Rol que lee el lector de pantalla en el asa (dnd-kit dice «sortable»).
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, attributes: { roleDescription: t("ordenable") } });
  const [draft, setDraft] = useState(s.title);
  // Evita guardar dos veces (Enter y el blur posterior) o guardar tras Escape.
  const settled = useRef(false);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onRename(draft.trim());
    else onRename("");
  };
  // El texto se selecciona solo al empezar a editar; al volver al campo (p. ej. con «Seguir editando») queda como estaba.
  const selected = useRef(false);
  const startEdit = () => {
    settled.current = false;
    selected.current = false;
    setDraft(s.title);
    onDraft(s.title);
    onEdit();
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50", isDragging && "relative z-10 bg-white shadow-md dark:bg-slate-800")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        style={{ touchAction: "none" }}
        className="-ml-0.5 shrink-0 cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing dark:hover:text-slate-300"
        aria-label={t("Arrastrar para reordenar")}
      >
        <GripVertical size={16} />
      </button>
      <input type="checkbox" checked={s.done} onChange={onToggle} className="h-4 w-4 accent-progress" aria-label={s.title} />
      {editing ? (
        <input
          className="input min-w-0 flex-1 py-0.5 text-sm"
          value={draft}
          maxLength={MAX_TITLE}
          autoFocus
          onFocus={(e) => {
            if (selected.current) return;
            selected.current = true;
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            onDraft(e.target.value);
          }}
          onPaste={(e) => pasteAsOneLine(e, (v) => {
            setDraft(v);
            onDraft(v);
          })}
          // Con la pregunta de cierre abierta (o tras «Descartar cambios») perder el foco no guarda: el campo sigue con su
          // texto para «Seguir editando», y descartar no lo guarda.
          onBlur={() => !blurHeld?.() && finish(true)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              // Cancela la edición sin cerrar el modal.
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
        />
      ) : (
        <span
          className={cn("flex-1 rounded-sm text-sm focus-visible:ring-3 focus-visible:ring-focus/50 focus-visible:outline-none", s.done && "text-slate-400 line-through")}
          tabIndex={0}
          aria-label={t("{title} (Enter o F2 para editar)", { title: s.title })}
          onDoubleClick={startEdit}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "F2") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              startEdit();
            }
          }}
        >
          {s.title}
        </span>
      )}
      {!editing && (
        <button type="button" className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100" onClick={startEdit} aria-label={t("Editar subtarea")}>
          <Pencil size={13} />
        </button>
      )}
      <button type="button" className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100" onClick={onRemove} aria-label={t("Borrar subtarea")}>
        <X size={14} />
      </button>
    </li>
  );
}

function GoogleLinks({ detail, setDetail, onCreate, taskId, canCreate }: {
  taskId: string;
  /** Google configurado en el servidor: se pueden crear documentos nuevos. */
  canCreate: boolean;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  onCreate: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
}) {
  const t = useT();
  const board = useBoard();
  const toast = useToast();
  const confirm = useConfirm();
  const links = detail?.links ?? [];
  return (
    <section>
      {/* Con tres botones, en el móvil pasan a la línea siguiente (antes el título se partía en tres líneas). */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <h3 className="mr-auto min-w-0 text-sm font-semibold">{t("Documentos de Google")}</h3>
        {canCreate && (
          <>
            <button className="btn-ghost shrink-0 whitespace-nowrap px-2 py-1 text-xs" onClick={() => onCreate("GOOGLE_DOC")} disabled={!detail}>
              <FileText size={15} className="text-sky-600" /> {t("Nuevo Doc")}
            </button>
            <button className="btn-ghost shrink-0 whitespace-nowrap px-2 py-1 text-xs" onClick={() => onCreate("GOOGLE_SHEET")} disabled={!detail}>
              <FileSpreadsheet size={15} className="text-emerald-600" /> {t("Nuevo Sheet")}
            </button>
            <button className="btn-ghost shrink-0 whitespace-nowrap px-2 py-1 text-xs" onClick={() => onCreate("GOOGLE_SLIDES")} disabled={!detail}>
              <GoogleFileIcon kind="GOOGLE_SLIDES" size={15} /> {t("Nuevo Slides")}
            </button>
          </>
        )}
      </div>
      {links.length === 0 ? (
        <p className="truncate text-xs text-slate-400">
          {t("Sin documentos · escribe")} <code>@docs</code>, <code>@sheets</code> {t("o")} <code>@slides</code>
        </p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <GoogleFileIcon kind={l.kind} size={17} className="shrink-0" />
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                {l.title}
              </a>
              {shareWarning(l, t) && (
                <span className="shrink-0 text-amber-600" title={shareWarning(l, t) ?? undefined} aria-label={shareWarning(l, t) ?? undefined} role="img">
                  <TriangleAlert size={15} />
                </span>
              )}
              <button
                className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
                aria-label={t("Quitar enlace")}
                title={t("Quitar el enlace (el archivo sigue en Google Drive)")}
                onClick={async () => {
                  if (!(await confirm({ title: t("Quitar enlace"), message: t("¿Quitar el enlace de la tarea? El archivo seguirá en Google Drive."), confirmLabel: t("Quitar"), danger: true }))) return;
                  const res = await board.track(deleteTaskLink(l.id));
                  if (!res.ok) return toast(res.error, "error");
                  setDetail((d) => (d ? { ...d, links: d.links.filter((x) => x.id !== l.id) } : d));
                  board.patchTask(taskId, (t) => ({ linkCount: Math.max(0, t.linkCount - 1) }));
                }}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Icono según el tipo del archivo adjunto (MIME y, si hace falta, extensión). */
function fileIcon(a: { mimeType: string; originalName: string }) {
  const mime = a.mimeType;
  const ext = a.originalName.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("video/")) return FileVideo;
  if (/zip|tar|gzip|rar|7z/.test(mime) || ["zip", "rar", "7z", "gz", "tar"].includes(ext)) return FileArchive;
  if (/spreadsheet|excel|csv/.test(mime) || ["xls", "xlsx", "ods", "csv"].includes(ext)) return FileSpreadsheet;
  if (/presentation|powerpoint/.test(mime) || ["ppt", "pptx", "odp", "key"].includes(ext)) return Presentation;
  if (mime === "text/html" || ["html", "htm"].includes(ext)) return FileCode;
  if (mime === "application/pdf" || mime.startsWith("text/") || /word|document|rtf/.test(mime) || ["pdf", "doc", "docx", "txt", "odt", "rtf", "md"].includes(ext)) return FileText;
  return FileIcon;
}
