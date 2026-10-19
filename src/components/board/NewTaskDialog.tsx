"use client";

import { Camera, File as FileIcon, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTask } from "@/actions/tasks";
import { Lightbox } from "../ui/Lightbox";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { MentionTextarea } from "../ui/MentionTextarea";
import { applyKindTemplate } from "@/lib/kinds-special";
import { TypeSelector } from "./TaskDialog";
import { filesFrom, isImageFile, uploadFile, useFileDrop } from "./upload";

interface Props {
  initialColumnId?: string;
  /** Crear la tarea como fija en la release (solo si la columna es la de la release). */
  initialEvergreen?: boolean;
  initialFiles?: File[];
  onClose: () => void;
}

function captureTitle(): string {
  return "Captura " + new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export function NewTaskDialog({ initialColumnId, initialEvergreen, initialFiles, onClose }: Props) {
  const board = useBoard();
  const toast = useToast();
  const [title, setTitle] = useState(() => (initialFiles?.length ? captureTitle() : ""));
  const [kindId, setKindId] = useState(board.kinds[0]?.id ?? "");
  const [columnId, setColumnId] = useState(initialColumnId ?? board.columns[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [deliverableId, setDeliverableId] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [evergreen, setEvergreen] = useState(!!initialEvergreen);
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
    setTitle((t) => t || captureTitle());
  };

  const dropping = useFileDrop(addFiles);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !columnId) return;
    setBusy(true);
    const res = await board.track(
      createTask({
        projectId: board.project.id, columnId, title, kindId, description,
        assigneeId: assigneeId || null, dueDate: dueDate || null, deliverableId: deliverableId || null,
        evergreen: isReleaseColumn && evergreen,
      }),
    );
    if (!res.ok) {
      setBusy(false);
      return toast(res.error, "error");
    }
    let task = res.data;
    board.upsertTask(task);
    // Los archivos se suben en paralelo tras crear la tarea.
    const results = await Promise.allSettled(files.map((f) => board.track(uploadFile(task.id, f))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (ok) {
      task = { ...task, attachmentCount: task.attachmentCount + ok };
      board.upsertTask(task);
    }
    if (failed) toast((failed.reason as Error).message, "error");
    else toast("Tarea creada");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva tarea"
      size="md"
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="new-task" className="btn-primary" disabled={busy || !title.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} Crear tarea
          </button>
        </>
      }
    >
      <form id="new-task" onSubmit={submit} className="space-y-3" onPaste={(e) => {
        const pasted = filesFrom(e.clipboardData.items);
        if (pasted.length) {
          e.preventDefault();
          addFiles(pasted);
        }
      }}>
        <div>
          <label className="label" htmlFor="nt-title">Título</label>
          <input id="nt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required data-autofocus />
        </div>
        <div>
          <div className="label">Tipo</div>
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
          <label className="label" htmlFor="nt-desc">Descripción (opcional)</label>
          <MentionTextarea id="nt-desc" className="input field-sizing-content min-h-14" value={description} onValueChange={setDescription} users={board.users} maxLength={20000} placeholder="Markdown · @persona para avisar" />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <div className="min-w-0">
            <label className="label" htmlFor="nt-column">Columna</label>
            <select id="nt-column" className="input" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor="nt-deliverable">Entregable (opcional)</label>
            <select id="nt-deliverable" className="input" value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">Sin entregable</option>
              {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor="nt-assignee">Asignada a (opcional)</label>
            <select id="nt-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Sin asignar</option>
              {board.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? `${u.name} (yo)` : u.name}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label truncate" htmlFor="nt-due">Fecha límite (opcional)</label>
            <input id="nt-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        {isReleaseColumn && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} />
            Fija en la release (evergreen)
          </label>
        )}
        <div>
          <div className="label">Capturas y adjuntos</div>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${previews[i]}`} className="relative">
                {isImageFile(f) ? (
                  <button type="button" className="block" onClick={() => setLightbox(imageIndexes.indexOf(i))} aria-label="Ver imagen">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[i]} alt="" className="h-14 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
                  </button>
                ) : (
                  <div className="flex h-14 max-w-40 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs dark:border-slate-700 dark:bg-slate-800" title={f.name}>
                    <FileIcon size={16} className="shrink-0 text-slate-500" />
                    <span className="line-clamp-2 break-all">{f.name}</span>
                  </div>
                )}
                <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-900 p-0.5 text-white" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label="Quitar archivo">
                  <X size={13} />
                </button>
              </div>
            ))}
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 dark:border-slate-700">
              <ImagePlus size={16} /> Archivo
              <input type="file" multiple className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <label className="flex h-14 w-20 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 sm:hidden dark:border-slate-700">
              <Camera size={16} /> Cámara
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { addFiles(filesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <p className="self-center text-xs text-slate-500 max-sm:hidden">o pega o arrastra archivos (máx. 10 MB)</p>
          </div>
        </div>
      </form>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-brand-500/15 p-4 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-lg font-semibold text-brand-700 shadow-xl dark:bg-slate-900/90 dark:text-brand-300">
            Suelta para adjuntar
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
