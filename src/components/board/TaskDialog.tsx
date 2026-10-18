"use client";

import { Archive, ExternalLink, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  addSubtask, archiveTask, deleteAttachment, deleteSubtask, deleteTask, getTaskDetail, moveTask, updateSubtask, updateTask,
} from "@/actions/tasks";
import { TASK_TYPE_META, TASK_TYPES, type TaskTypeValue } from "@/lib/constants";
import type { AttachmentInfo, BoardTask, SubtaskInfo, TaskDetail } from "@/lib/types";
import { ColorPicker } from "../ui/ColorPicker";
import { cn } from "../ui/cn";
import { Markdown } from "../ui/Markdown";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { imageFilesFrom, uploadImage } from "./upload";

export function TaskDialog({ task, onClose }: { task: BoardTask; onClose: () => void }) {
  const board = useBoard();
  const toast = useToast();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState(task.title);
  const [link, setLink] = useState(task.linkUrl ?? "");
  const [uploading, setUploading] = useState(0);
  const [lightbox, setLightbox] = useState<AttachmentInfo | null>(null);

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

  /** Guardado optimista de campos de la tarjeta. */
  const save = async (patch: Parameters<typeof updateTask>[1], optimistic: Partial<BoardTask>) => {
    const before = board.taskById.get(task.id);
    board.patchTask(task.id, optimistic);
    const res = await board.track(updateTask(task.id, patch));
    if (!res.ok) {
      if (before) board.upsertTask(before);
      return toast(res.error, "error");
    }
    board.upsertTask(res.data);
  };

  const changeColumn = async (columnId: string) => {
    if (columnId === task.columnId) return;
    const before = board.taskById.get(task.id)!;
    const last = Math.max(0, ...[...board.taskById.values()].filter((t) => t.columnId === columnId).map((t) => t.position));
    board.patchTask(task.id, { columnId, position: last + 1024 });
    const res = await board.track(moveTask(task.id, columnId, null, null));
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
        const att = await board.track(uploadImage(task.id, file));
        setDetail((d) => (d ? { ...d, attachments: [...d.attachments, att] } : d));
        board.patchTask(task.id, (t) => ({ attachmentCount: t.attachmentCount + 1 }));
      } catch (err) {
        toast((err as Error).message, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = imageFilesFrom(e.clipboardData.items);
    if (files.length) {
      e.preventDefault();
      upload(files);
    }
  };

  const remove = async () => {
    if (!window.confirm("¿Borrar definitivamente esta tarea y sus adjuntos?")) return;
    const res = await board.track(deleteTask(task.id));
    if (!res.ok) return toast(res.error, "error");
    board.removeTask(task.id);
    onClose();
    toast("Tarea borrada");
  };

  const archive = async () => {
    const res = await board.track(archiveTask(task.id));
    if (!res.ok) return toast(res.error, "error");
    board.removeTask(task.id);
    onClose();
    toast("Tarea archivada");
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
      size="xl"
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
            aria-label="Título"
          />
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
      }
    >
      <div onPaste={onPaste} className="grid gap-6 md:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-6">
          <DescriptionEditor
            key={detail ? "loaded" : "loading"}
            initial={detail?.description ?? null}
            onSave={(description) => {
              setDetail((d) => (d ? { ...d, description } : d));
              save({ description }, { hasDescription: description.trim().length > 0 });
            }}
          />
          <Subtasks taskId={task.id} detail={detail} setDetail={setDetail} />
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Capturas y adjuntos</h3>
              <label className="btn-ghost cursor-pointer py-1 text-xs">
                <ImagePlus size={15} /> Añadir
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { upload(imageFilesFrom(e.target.files)); e.target.value = ""; }} />
              </label>
            </div>
            <p className="mb-2 text-xs text-slate-500">Pega una imagen con Ctrl+V / ⌘+V en cualquier parte de esta ventana.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {detail?.attachments.map((a) => (
                <div key={a.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  <button type="button" onClick={() => setLightbox(a)} className="block w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/attachments/${a.id}?thumb=1`} alt={a.originalName} loading="lazy" className="aspect-video w-full object-cover" />
                  </button>
                  <button
                    type="button"
                    className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 max-md:opacity-100"
                    aria-label="Borrar adjunto"
                    onClick={async () => {
                      if (!window.confirm("¿Borrar esta imagen?")) return;
                      const res = await board.track(deleteAttachment(a.id));
                      if (!res.ok) return toast(res.error, "error");
                      setDetail((d) => (d ? { ...d, attachments: d.attachments.filter((x) => x.id !== a.id) } : d));
                      board.patchTask(task.id, (t) => ({ attachmentCount: Math.max(0, t.attachmentCount - 1) }));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 dark:border-slate-700">
                  <Loader2 size={16} className="mr-1.5 animate-spin" /> Subiendo…
                </div>
              )}
            </div>
            {detail && detail.attachments.length === 0 && uploading === 0 && (
              <p className="text-xs text-slate-400">Sin adjuntos.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 text-sm">
          <Field label="Columna">
            <select className="input" value={task.columnId} onChange={(e) => changeColumn(e.target.value)}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tipo">
            <TypeSelector value={task.type} onChange={(type) => save({ type }, { type })} />
          </Field>
          <Field label="Asignada a">
            <select
              className="input"
              value={task.assigneeId ?? ""}
              onChange={(e) => save({ assigneeId: e.target.value || null }, { assigneeId: e.target.value || null })}
            >
              <option value="">Sin asignar</option>
              {board.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Color">
            <ColorPicker value={task.color} onChange={(color) => save({ color: color as never }, { color })} />
          </Field>
          <Field label="Etiquetas">
            <div className="flex flex-wrap gap-1.5">
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
                    style={on ? { backgroundColor: l.color } : undefined}
                    aria-pressed={on}
                  >
                    {l.name}
                  </button>
                );
              })}
              <Link href={`/p/${board.project.id}/settings#labels`} className="px-1 py-0.5 text-xs text-brand-600 hover:underline">
                Gestionar
              </Link>
            </div>
          </Field>
          <Field label="Enlace externo (PR, commit, issue)">
            <div className="flex gap-1">
              <input
                className="input"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onBlur={commitLink}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              {task.linkUrl && (
                <a href={task.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-icon h-9 w-9 shrink-0" aria-label="Abrir enlace">
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          </Field>
          {detail && (
            <p className="text-xs text-slate-500">
              Creada {detail.createdByName ? `por ${detail.createdByName} ` : ""}el {new Date(detail.createdAt).toLocaleDateString("es-ES")}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button className="btn-secondary py-1.5" onClick={archive}><Archive size={15} /> Archivar</button>
            <button className="btn-ghost py-1.5 text-red-600" onClick={remove}><Trash2 size={15} /> Borrar</button>
          </div>
        </aside>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/attachments/${lightbox.id}`} alt={lightbox.originalName} className="max-h-full max-w-full rounded-lg" />
          <a
            href={`/api/attachments/${lightbox.id}?download=1`}
            onClick={(e) => e.stopPropagation()}
            className="btn-secondary absolute top-4 right-4"
          >
            Descargar
          </a>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

export function TypeSelector({ value, onChange }: { value: TaskTypeValue; onChange: (t: TaskTypeValue) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TASK_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "badge cursor-pointer px-2 py-1 text-xs",
            value === t ? TASK_TYPE_META[t].badge : "bg-transparent text-slate-500 ring-slate-300 dark:ring-slate-700",
          )}
          aria-pressed={value === t}
        >
          {TASK_TYPE_META[t].label}
        </button>
      ))}
    </div>
  );
}

function DescriptionEditor({ initial, onSave }: { initial: string | null; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  if (initial === null) {
    return <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />;
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Descripción</h3>
        {!editing && (
          <button className="btn-ghost py-1 text-xs" onClick={() => { setEditing(true); requestAnimationFrame(() => ref.current?.focus()); }}>
            Editar
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={ref}
            className="input field-sizing-content min-h-32 font-mono text-[13px]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={20000}
            placeholder="Admite Markdown: **negrita**, listas, `código`, [enlaces](https://…)"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setValue(initial);
                setEditing(false);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setEditing(false);
                if (value !== initial) onSave(value);
              }
            }}
          />
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={() => { setEditing(false); if (value !== initial) onSave(value); }}>Guardar</button>
            <button className="btn-ghost py-1.5" onClick={() => { setValue(initial); setEditing(false); }}>Cancelar</button>
            <span className="ml-auto self-center text-xs text-slate-400">Ctrl/⌘ + Enter para guardar</span>
          </div>
        </div>
      ) : value.trim() ? (
        <div className="cursor-text rounded-lg p-1 hover:bg-slate-50 dark:hover:bg-slate-800/50" onDoubleClick={() => setEditing(true)}>
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <button className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-left text-sm text-slate-400 hover:border-brand-500 dark:border-slate-700" onClick={() => setEditing(true)}>
          Añade una descripción…
        </button>
      )}
    </section>
  );
}

function Subtasks({ taskId, detail, setDetail }: { taskId: string; detail: TaskDetail | null; setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>> }) {
  const board = useBoard();
  const toast = useToast();
  const [newTitle, setNewTitle] = useState("");
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
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Checklist</h3>
        {list.length > 0 && <span className="text-xs text-slate-500">{done}/{list.length}</span>}
      </div>
      {list.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / list.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {list.map((s) => (
          <li key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <input type="checkbox" checked={s.done} onChange={() => toggle(s)} className="h-4 w-4 accent-emerald-600" aria-label={s.title} />
            <span className={cn("flex-1 text-sm", s.done && "text-slate-400 line-through")}>{s.title}</span>
            <button className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 max-md:opacity-100" onClick={() => remove(s)} aria-label="Borrar subtarea">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-1 flex gap-2">
        <input className="input py-1.5" placeholder="Añadir elemento…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} disabled={!detail} />
        <button className="btn-secondary py-1.5" disabled={!newTitle.trim()} aria-label="Añadir subtarea"><Plus size={15} /></button>
      </form>
    </section>
  );
}
