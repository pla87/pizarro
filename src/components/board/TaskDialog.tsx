"use client";

import { Archive, Camera, Check, Download, ExternalLink, File as FileIcon, FileArchive, FileAudio, FileSpreadsheet, FileText, FileVideo, GripVertical, ImagePlus, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  addComment, addSubtask, archiveTask, deleteAttachment, deleteComment, deleteSubtask, deleteTask, deleteTaskLink, getTaskDetail,
  moveTask, reorderSubtask, updateSubtask, updateTask,
} from "@/actions/tasks";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useIntlLocale, useT } from "@/i18n/client";
import { dueStatus } from "@/lib/dates";
import { isWhite, kindBadgeStyle, onColor } from "@/lib/constants";
import type { BoardTask, KindOption, SubtaskInfo, TaskDetail, TaskLinkInfo, UserOption } from "@/lib/types";
import { Avatar } from "../ui/Avatar";
import { ColorPicker } from "../ui/ColorPicker";
import { cn } from "../ui/cn";
import { DescriptionField } from "../ui/DescriptionField";
import { Markdown } from "../ui/Markdown";
import { MentionTextarea, type MentionCommand } from "../ui/MentionTextarea";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { applyKindTemplate } from "@/lib/kinds-special";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { TaskViewers } from "./TaskViewers";
import { createAndOpenGoogleFile } from "./google";
import { filesFrom, formatBytes, uploadFile, useFileDrop } from "./upload";
import { formatDate } from "@/lib/format";
import { draftKey, useDraftAutosave, type EditTaskDraft } from "./drafts";
import { setUndoTask, UNDONE_EVENT } from "../undo-context";
import { useIsMobile } from "../ui/useIsMobile";

export function TaskDialog({ task, onClose: close, side, onAddSecond, draft }: {
  task: BoardTask;
  onClose: () => void;
  side?: "left" | "right" | "center";
  onAddSecond?: () => void;
  /** Borrador recuperado (la página se cerró con la tarea abierta). */
  draft?: EditTaskDraft | null;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const board = useBoard();
  const toast = useToast();
  const mobile = useIsMobile();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState(draft?.title ?? task.title);
  // Descripción en edición (la comunica el editor): para el botón Guardar y el borrador local.
  const descDraft = useRef<string | null>(null);
  const [draftUsed, setDraftUsed] = useState(false);
  // Borrador local cada 5 s: al volver tras cerrar la página, la tarea se reabre con lo escrito.
  // Solo hay borrador si queda algo sin guardar; si no, se borra (no se reabre una tarea ya cerrada).
  const discardDraft = useDraftAutosave(draftKey("edit", board.currentUserId, board.project.id), (): EditTaskDraft | null => {
    const desc = descDraft.current;
    const descChanged = desc !== null && desc !== (detail?.description ?? "");
    if (title === task.title && !descChanged) return null;
    return { taskId: task.id, ...(title !== task.title ? { title } : {}), ...(descChanged ? { description: desc } : {}) };
  });
  const onClose = () => {
    discardDraft();
    close();
  };

  // Si el título cambia desde fuera (recarga tras un conflicto, deshacer), se muestra el nuevo.
  const [shownTitle, setShownTitle] = useState(task.title);
  if (shownTitle !== task.title) {
    setShownTitle(task.title);
    setTitle(task.title);
  }
  // Se incrementa al cambiar la descripción desde fuera del editor para que se remonte con el texto nuevo.
  const [descVersion, setDescVersion] = useState(0);
  const [link, setLink] = useState(task.linkUrl ?? "");
  const [uploading, setUploading] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getTaskDetail(task.id).then((res) => {
      if (!alive) return;
      if (res.ok) setDetail(res.data);
      else toast(res.error, "error");
    });
    return () => {
      alive = false;
    };
  }, [task.id, toast]);

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
    const res = await getTaskDetail(task.id);
    if (!res.ok) return;
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

  /** Botón Guardar (móvil): guarda título y descripción tal como estén escritos y cierra. */
  const saveAndClose = async () => {
    const value = title.trim();
    const patch: { title?: string; description?: string } = {};
    if (value && value !== task.title) patch.title = value;
    const desc = descDraft.current;
    if (desc !== null && desc !== (detail?.description ?? "")) patch.description = desc;
    if (patch.title !== undefined || patch.description !== undefined) {
      if (patch.description !== undefined) setDetail((d) => (d ? { ...d, description: desc! } : d));
      const ok = await save(patch, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { hasDescription: patch.description.trim().length > 0 } : {}),
      });
      if (!ok) return;
    }
    onClose();
  };

  /** Guardado optimista de campos de la tarjeta. */
  const save = async (patch: Parameters<typeof updateTask>[1], optimistic: Partial<BoardTask>): Promise<boolean> => {
    const before = board.taskById.get(task.id);
    board.patchTask(task.id, optimistic);
    // Título y descripción: se envía qué versión se estaba editando para no pisar a otra persona.
    const editsText = patch.title !== undefined || patch.description !== undefined;
    const res = await tracked(updateTask(task.id, patch, editsText ? (detail?.textVersion ?? null) : undefined));
    if (!res.ok) {
      if (before) board.upsertTask(before);
      toast(res.error, "error");
      if (editsText) await reload();
      return false;
    }
    board.upsertTask(res.data);
    if (editsText) setDetail((d) => (d ? { ...d, textVersion: res.data.textVersion } : d));
    return true;
  };

  const changeColumn = async (columnId: string) => {
    if (columnId === task.columnId) return;
    const before = board.taskById.get(task.id)!;
    const last = Math.max(0, ...[...board.taskById.values()].filter((t) => t.columnId === columnId).map((t) => t.position));
    board.patchTask(task.id, { columnId, position: last + 1024, evergreen: false });
    const res = await tracked(moveTask(task.id, columnId, null, null));
    if (!res.ok) {
      board.upsertTask(before);
      return toast(res.error, "error");
    }
    board.patchTask(task.id, { position: res.data.position });
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading((n) => n + files.length);
    for (const file of files) {
      try {
        const att = await board.track(uploadFile(task.id, file, false, t));
        setDetail((d) => (d ? { ...d, attachments: [...d.attachments, att] } : d));
        board.patchTask(task.id, (t) => ({ attachmentCount: t.attachmentCount + 1 }));
      } catch (err) {
        toast((err as Error).message, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const images = detail?.attachments.filter((a) => a.isImage) ?? [];
  const files = detail?.attachments.filter((a) => !a.isImage) ?? [];

  const removeAttachment = async (id: string, question: string) => {
    if (!window.confirm(question)) return;
    const res = await board.track(deleteAttachment(id));
    if (!res.ok) return toast(res.error, "error");
    setDetail((d) => (d ? { ...d, attachments: d.attachments.filter((x) => x.id !== id) } : d));
    board.patchTask(task.id, (t) => ({ attachmentCount: Math.max(0, t.attachmentCount - 1) }));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = filesFrom(e.clipboardData.items);
    if (files.length) {
      e.preventDefault();
      upload(files);
    }
  };
  const dropping = useFileDrop(upload);

  const remove = async () => {
    if (!window.confirm(t("¿Borrar definitivamente esta tarea y sus adjuntos?"))) return;
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
    onClose();
    toast(t("Tarea archivada"));
  };

  /** @docs / @sheets: crea el archivo, lo abre en otra pestaña y lo enlaza. Debe llamarse dentro de un clic o tecla. */
  const createGoogle = async (kind: MentionCommand): Promise<TaskLinkInfo | null> => {
    if (!board.google.enabled) {
      toast(t("La integración con Google no está configurada en el servidor."), "error");
      return null;
    }
    if (!board.google.connected) {
      toast(t("Conecta tu cuenta de Google en «Mi perfil y plantillas» para crear documentos."), "error");
      return null;
    }
    const res = await board.track(createAndOpenGoogleFile(task.id, kind, title.trim() || task.title, t));
    if (!res.ok) {
      toast(res.error, "error");
      return null;
    }
    setDetail((d) => (d ? { ...d, links: [...d.links, res.link] } : d));
    board.patchTask(task.id, (t) => ({ linkCount: t.linkCount + 1 }));
    toast(kind === "GOOGLE_SHEET" ? t("Hoja de cálculo creada") : t("Documento creado"));
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

  const commitTitle = () => {
    const value = title.trim();
    if (!value) return setTitle(task.title);
    if (value !== task.title) save({ title: value }, { title: value });
  };

  const commitLink = () => {
    const value = link.trim();
    if (value === (task.linkUrl ?? "")) return;
    save({ linkUrl: value }, { linkUrl: value || null });
  };

  return (
    <Modal
      open
      onClose={onClose}
      side={side}
      onAddSecond={onAddSecond}
      size="xl"
      placement="top"
      // Móvil: pie siempre visible con Archivar, Borrar y Guardar.
      footer={
        mobile ? (
          <>
            <button className="btn-secondary py-1.5" onClick={archive}><Archive size={15} /> {t("Archivar")}</button>
            <button className="btn-ghost py-1.5 text-red-600" onClick={remove}><Trash2 size={15} /> {t("Borrar")}</button>
            <button className="btn-primary ml-auto py-1.5" onClick={saveAndClose}><Check size={15} /> {t("Guardar")}</button>
          </>
        ) : undefined
      }
      // Escritorio: la altura se adapta al contenido (tope = viewport); solo hacen scroll las columnas si hay mucho contenido.
      header={
        <div className="flex items-start gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            rows={1}
            maxLength={200}
            className="field-sizing-content min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none focus:bg-slate-50 dark:focus:bg-slate-800"
            aria-label={t("Título")}
          />
          <span className="mt-1.5 flex h-5 shrink-0 items-center text-xs" role="status" aria-live="polite">
            {saving > 0 ? (
              <span className="flex items-center gap-1 text-slate-500"><Loader2 size={13} className="animate-spin" /> {t("Guardando…")}</span>
            ) : (
              <span className={cn("flex items-center gap-1 text-emerald-600 transition-opacity duration-500 dark:text-emerald-400", justSaved ? "opacity-100" : "opacity-0")}>
                <Check size={13} /> {t("Guardado")}
              </span>
            )}
          </span>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t("Cerrar")}>
            <X size={18} />
          </button>
        </div>
      }
    >
      <div onPaste={onPaste} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6 md:max-h-[calc(100dvh-9rem)] md:overflow-y-auto md:pr-2">
          <TaskViewers taskId={task.id} />
          <DescriptionEditor
            key={detail ? `loaded-${descVersion}` : "loading"}
            users={board.users}
            onGoogle={createGoogle}
            initial={detail?.description ?? null}
            // El borrador recuperado solo se aplica la primera vez que se carga la tarea.
            draft={detail && !draftUsed && descVersion === 0 ? draft?.description : undefined}
            onDraftChange={(md) => {
              descDraft.current = md;
              if (md !== null && !draftUsed) setDraftUsed(true);
            }}
            onSave={(description) => {
              setDetail((d) => (d ? { ...d, description } : d));
              save({ description }, { hasDescription: description.trim().length > 0 });
            }}
          />
          <Subtasks taskId={task.id} detail={detail} setDetail={setDetail} />
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("Capturas y adjuntos")}</h3>
              <div className="flex items-center gap-1">
                <label className="btn-ghost cursor-pointer py-1 text-xs sm:hidden">
                  <Camera size={15} /> {t("Cámara")}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { upload(filesFrom(e.target.files)); e.target.value = ""; }} />
                </label>
                <label className="btn-ghost cursor-pointer py-1 text-xs">
                  <ImagePlus size={15} /> {t("Añadir")}
                  <input type="file" multiple className="sr-only" onChange={(e) => { upload(filesFrom(e.target.files)); e.target.value = ""; }} />
                </label>
              </div>
            </div>
            <p className="mb-2 truncate text-xs text-slate-500 max-sm:hidden">{t("Pega o arrastra archivos (máx. 10 MB)")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((a, i) => (
                <div key={a.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <button type="button" onClick={() => setLightbox(i)} className="block w-full" aria-label={t("Ver {name}", { name: a.originalName })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/attachments/${a.id}?thumb=1`} alt={a.originalName} loading="lazy" className="aspect-video w-full object-cover" />
                  </button>
                  <button
                    type="button"
                    className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 max-md:opacity-100"
                    aria-label={t("Borrar adjunto")}
                    onClick={() => removeAttachment(a.id, t("¿Borrar esta imagen?"))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 dark:border-slate-700">
                  <Loader2 size={16} className="mr-1.5 animate-spin" /> {t("Subiendo…")}
                </div>
              )}
            </div>
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
                      <button type="button" className="btn-icon h-7 w-7 shrink-0 text-red-600" aria-label={t("Borrar adjunto")} onClick={() => removeAttachment(a.id, t("¿Borrar este archivo?"))}>
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
          <GoogleLinks taskId={task.id} detail={detail} setDetail={setDetail} onCreate={createGoogle} />
          <Comments taskId={task.id} detail={detail} setDetail={setDetail} users={board.users} onGoogle={createGoogle} />
        </div>

        <aside className="flex flex-col gap-4 text-sm md:max-h-[calc(100dvh-9rem)] md:gap-2.5 md:overflow-y-auto md:pr-1">
          <Field label={t("Columna")}>
            <select className="input md:py-1.5" value={task.columnId} onChange={(e) => changeColumn(e.target.value)}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {board.columns.find((c) => c.id === task.columnId)?.role === "NEXT_RELEASE" && (
            <label className="flex items-center gap-2" title={t("Se queda en la columna de la release al desplegar y se incluye siempre en el texto")}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={task.evergreen}
                onChange={(e) => save({ evergreen: e.target.checked }, { evergreen: e.target.checked })}
              />
              {t("Fija en la release (evergreen)")}
            </label>
          )}
          <Field label={t("Tipo")}>
            <TypeSelector kinds={board.kinds} value={task.kindId} onChange={changeKind} />
          </Field>
          <Field label={t("Asignada a (opcional)")}>
            <select
              className="input md:py-1.5"
              value={task.assigneeId ?? ""}
              onChange={(e) => save({ assigneeId: e.target.value || null }, { assigneeId: e.target.value || null })}
            >
              <option value="">{t("Sin asignar")}</option>
              {board.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label={t("Fecha límite")}>
            <div className="flex gap-1">
              <input
                type="date"
                className={cn(
                  "input md:py-1.5",
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
                <button className="btn-icon h-9 w-9 shrink-0 md:h-8 md:w-8" onClick={() => save({ dueDate: null }, { dueDate: null })} aria-label={t("Quitar fecha límite")}>
                  <X size={15} />
                </button>
              )}
            </div>
          </Field>
          <Field label={t("Entregable")}>
            <select
              className="input md:py-1.5"
              value={task.deliverableId ?? ""}
              onChange={(e) => save({ deliverableId: e.target.value || null }, { deliverableId: e.target.value || null })}
            >
              <option value="">{t("Sin entregable")}</option>
              {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t("Color")}>
            {/* Escritorio: swatches más pequeños y juntos para que quepan en una sola fila. */}
            <div className="md:[&>div]:gap-1 md:[&_button]:h-[22px] md:[&_button]:w-[22px]">
              <ColorPicker value={task.color} onChange={(color) => save({ color: color as never }, { color })} />
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
              <Link href={`/p/${board.project.id}/settings#labels`} className="px-1 py-0.5 text-xs text-brand-600 hover:underline">
                {t("Gestionar")}
              </Link>
            </div>
          </Field>
          <Field label={t("Enlace externo (PR, commit, issue)")}>
            <div className="flex gap-1">
              <input
                className="input md:py-1.5"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onBlur={commitLink}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              {task.linkUrl && (
                <a href={task.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-icon h-9 w-9 shrink-0 md:h-8 md:w-8" aria-label={t("Abrir enlace")}>
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          </Field>
          {detail && (
            <p className="text-xs text-slate-500">
              {detail.createdByName
                ? t("Creada por {name} el {date}", { name: detail.createdByName, date: formatDate(detail.createdAt, "dateShort", locale) })
                : t("Creada el {date}", { date: formatDate(detail.createdAt, "dateShort", locale) })}
            </p>
          )}
          {/* En móvil estos botones van en el pie fijo, junto a Guardar. */}
          <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-200 pt-4 max-md:hidden md:gap-1 md:pt-2.5 dark:border-slate-800">
            <button className="btn-secondary py-1.5" onClick={archive}><Archive size={15} /> {t("Archivar")}</button>
            <button className="btn-ghost py-1.5 text-red-600" onClick={remove}><Trash2 size={15} /> {t("Borrar")}</button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label md:mb-0.5">{label}</div>
      {children}
    </div>
  );
}

export function TypeSelector({ kinds, value, onChange }: { kinds: KindOption[]; value: string; onChange: (kindId: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <button
          key={k.id}
          type="button"
          onClick={() => onChange(k.id)}
          className={cn("badge cursor-pointer px-2 py-1 text-xs", value === k.id ? "kind-badge" : "bg-transparent text-slate-500 ring-slate-300 dark:ring-slate-700")}
          style={value === k.id ? kindBadgeStyle(k.color) : undefined}
          aria-pressed={value === k.id}
        >
          {k.name}
        </button>
      ))}
    </div>
  );
}

function DescriptionEditor({ initial, draft, onSave, users, onGoogle, onDraftChange }: {
  initial: string | null;
  /** Texto recuperado de un borrador: el editor empieza editándolo. */
  draft?: string;
  onSave: (v: string) => void;
  users: UserOption[];
  onGoogle: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
  /** Borrador actual en Markdown mientras se edita (con retardo); null al no estar editando. */
  onDraftChange?: (markdown: string | null) => void;
}) {
  const t = useT();
  const { editorMode } = useBoard();
  const [value, setValue] = useState(draft ?? initial ?? "");
  const [editing, setEditing] = useState(draft !== undefined);
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

  if (initial === null) {
    return <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />;
  }

  const finish = () => {
    setEditing(false);
    if (value !== initial) onSave(value);
  };
  const cancel = () => {
    setValue(initial);
    setEditing(false);
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("Descripción")}</h3>
        {!editing && (
          <button className="btn-ghost py-1 text-xs" onClick={() => { setEditing(true); requestAnimationFrame(() => ref.current?.focus()); }}>
            {t("Editar")}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <DescriptionField
            mode={editorMode}
            textareaRef={ref}
            value={value}
            onValueChange={setValue}
            users={users}
            autoFocus
            onCommand={async (kind) => {
              const link = await onGoogle(kind);
              if (link) setValue((v) => `${v.trimEnd()}\n\n${kind === "GOOGLE_SHEET" ? t("Hoja") : t("Documento")}: [${link.title.replace(/[\[\]]/g, "")}](${link.url})\n`);
            }}
            maxLength={20000}
            placeholder={t("Markdown · @persona · @docs / @sheets")}
            onCancel={cancel}
            onSubmit={finish}
          />
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={finish}>{t("Guardar")}</button>
            <button className="btn-ghost py-1.5" onClick={cancel}>{t("Cancelar")}</button>
            <span className="ml-auto self-center text-xs text-slate-400 max-sm:hidden">{t("Ctrl+Enter para guardar")}</span>
          </div>
        </div>
      ) : value.trim() ? (
        <div className="cursor-text rounded-lg p-1 hover:bg-slate-50 dark:hover:bg-slate-800/50" onDoubleClick={() => setEditing(true)}>
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <button className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-left text-sm text-slate-400 hover:border-brand-500 dark:border-slate-700" onClick={() => setEditing(true)}>
          {t("Añade una descripción…")}
        </button>
      )}
    </section>
  );
}

function Subtasks({ taskId, detail, setDetail }: { taskId: string; detail: TaskDetail | null; setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>> }) {
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

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    const res = await board.track(addSubtask(taskId, title));
    if (!res.ok) return toast(res.error, "error");
    update((l) => [...l, res.data]);
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

  const rename = async (s: SubtaskInfo, title: string) => {
    setEditingId(null);
    if (!title || title === s.title) return;
    update((l) => l.map((x) => (x.id === s.id ? { ...x, title } : x)));
    const res = await board.track(updateSubtask(s.id, { title }));
    if (!res.ok) {
      update((l) => l.map((x) => (x.id === s.id ? { ...x, title: s.title } : x)));
      toast(res.error, "error");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {list.map((s) => (
              <SubtaskRow key={s.id} s={s} editing={editingId === s.id} onEdit={() => setEditingId(s.id)} onRename={(v) => rename(s, v)} onToggle={() => toggle(s)} onRemove={() => remove(s)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <form onSubmit={add} className="mt-1 flex gap-2">
        <input className="input py-1.5" placeholder={t("Añadir subtarea…")} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} disabled={!detail} />
        <button className="btn-secondary py-1.5" disabled={!newTitle.trim()} aria-label={t("Añadir subtarea")}><Plus size={15} /></button>
      </form>
    </section>
  );
}

/** Fila ordenable: agarre de seis puntos, título editable con doble clic/toque y borrado. */
function SubtaskRow({ s, editing, onEdit, onRename, onToggle, onRemove }: {
  s: SubtaskInfo; editing: boolean; onEdit: () => void; onRename: (title: string) => void; onToggle: () => void; onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const [draft, setDraft] = useState(s.title);
  // Evita guardar dos veces (Enter y el blur posterior) o guardar tras Escape.
  const settled = useRef(false);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onRename(draft.trim());
    else onRename("");
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
          maxLength={200}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
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
          className={cn("flex-1 text-sm", s.done && "text-slate-400 line-through")}
          onDoubleClick={() => {
            settled.current = false;
            setDraft(s.title);
            onEdit();
          }}
        >
          {s.title}
        </span>
      )}
      <button className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 max-md:opacity-100" onClick={onRemove} aria-label={t("Borrar subtarea")}>
        <X size={14} />
      </button>
    </li>
  );
}

function GoogleLinks({ detail, setDetail, onCreate, taskId }: {
  taskId: string;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  onCreate: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
}) {
  const t = useT();
  const board = useBoard();
  const toast = useToast();
  const links = detail?.links ?? [];
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <h3 className="mr-auto text-sm font-semibold">{t("Documentos de Google")}</h3>
        <button className="btn-ghost py-1 text-xs" onClick={() => onCreate("GOOGLE_DOC")} disabled={!detail}>
          <FileText size={15} className="text-sky-600" /> {t("Nuevo Doc")}
        </button>
        <button className="btn-ghost py-1 text-xs" onClick={() => onCreate("GOOGLE_SHEET")} disabled={!detail}>
          <FileSpreadsheet size={15} className="text-emerald-600" /> {t("Nuevo Sheet")}
        </button>
      </div>
      {links.length === 0 ? (
        <p className="truncate text-xs text-slate-400">
          {t("Sin documentos · escribe")} <code>@docs</code> {t("o")} <code>@sheets</code>
        </p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {l.kind === "GOOGLE_SHEET" ? <FileSpreadsheet size={17} className="text-emerald-600" /> : <FileText size={17} className="text-sky-600" />}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                {l.title}
              </a>
              <button
                className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                aria-label={t("Quitar enlace")}
                title={t("Quitar el enlace (el archivo sigue en Google Drive)")}
                onClick={async () => {
                  if (!window.confirm(t("¿Quitar el enlace de la tarea? El archivo seguirá en Google Drive."))) return;
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

function Comments({ taskId, detail, setDetail, users, onGoogle }: {
  taskId: string;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  users: UserOption[];
  onGoogle: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const board = useBoard();
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const comments = detail?.comments ?? [];

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await board.track(addComment(taskId, body));
    setSending(false);
    if (!res.ok) return toast(res.error, "error");
    setText("");
    setDetail((d) => (d ? { ...d, comments: [...d.comments, res.data] } : d));
    board.patchTask(taskId, (t) => ({ commentCount: t.commentCount + 1 }));
  };

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Comentarios")} {comments.length > 0 && <span className="font-normal text-slate-500">{comments.length}</span>}</h3>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="group flex gap-2">
            {c.authorId ? <Avatar id={c.authorId} name={c.authorName ?? "?"} /> : <span className="h-6 w-6" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-semibold">{c.authorName ?? t("Usuario eliminado")}</span>
                <time className="text-slate-400">{formatDate(c.createdAt, "dateTimeShort", locale)}</time>
                {(c.authorId === board.currentUserId) && (
                  <button
                    className="ml-auto text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-600 max-md:opacity-100"
                    onClick={async () => {
                      if (!window.confirm(t("¿Borrar este comentario?"))) return;
                      const res = await board.track(deleteComment(c.id));
                      if (!res.ok) return toast(res.error, "error");
                      setDetail((d) => (d ? { ...d, comments: d.comments.filter((x) => x.id !== c.id) } : d));
                      board.patchTask(taskId, (t) => ({ commentCount: Math.max(0, t.commentCount - 1) }));
                    }}
                  >
                    {t("Borrar")}
                  </button>
                )}
              </div>
              <div className="mt-0.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <Markdown>{c.body}</Markdown>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2">
        <MentionTextarea
          className="input field-sizing-content min-h-16"
          value={text}
          onValueChange={setText}
          users={users}
          disabled={!detail}
          placeholder={t("Comenta… (@persona, @docs, @sheets)")}
          onCommand={async (kind) => {
            const link = await onGoogle(kind);
            if (link) setText((v) => `${v.trimEnd()} [${link.title.replace(/[\[\]]/g, "")}](${link.url}) `.trimStart());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={10000}
          aria-label={t("Nuevo comentario")}
        />
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-slate-400 max-sm:hidden">{t("Ctrl+Enter para enviar")}</span>
          <button className="btn-primary ml-auto py-1.5" onClick={send} disabled={sending || !text.trim()}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t("Comentar")}
          </button>
        </div>
      </div>
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
  if (mime === "application/pdf" || mime.startsWith("text/") || /word|document|rtf/.test(mime) || ["pdf", "doc", "docx", "txt", "odt", "rtf", "md"].includes(ext)) return FileText;
  return FileIcon;
}
