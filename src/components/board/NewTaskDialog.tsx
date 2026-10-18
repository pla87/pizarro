"use client";

import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTask } from "@/actions/tasks";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { MentionTextarea } from "../ui/MentionTextarea";
import { TypeSelector } from "./TaskDialog";
import { imageFilesFrom, uploadImage } from "./upload";

interface Props {
  initialColumnId?: string;
  initialFiles?: File[];
  onClose: () => void;
}

function captureTitle(): string {
  return "Captura " + new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export function NewTaskDialog({ initialColumnId, initialFiles, onClose }: Props) {
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
  const [busy, setBusy] = useState(false);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    setFiles((prev) => [...prev, ...list].slice(0, 10));
    // Con una captura y sin título, se propone uno para ir más rápido.
    setTitle((t) => t || captureTitle());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !columnId) return;
    setBusy(true);
    const res = await board.track(
      createTask({
        projectId: board.project.id, columnId, title, kindId, description,
        assigneeId: assigneeId || null, dueDate: dueDate || null, deliverableId: deliverableId || null,
      }),
    );
    if (!res.ok) {
      setBusy(false);
      return toast(res.error, "error");
    }
    let task = res.data;
    board.upsertTask(task);
    // Las imágenes se suben en paralelo tras crear la tarea.
    const results = await Promise.allSettled(files.map((f) => board.track(uploadImage(task.id, f))));
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
    <Modal open onClose={onClose} title="Nueva tarea" size="md">
      <form id="new-task" onSubmit={submit} className="space-y-4" onPaste={(e) => {
        const pasted = imageFilesFrom(e.clipboardData.items);
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
          <TypeSelector kinds={board.kinds} value={kindId} onChange={setKindId} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="nt-column">Columna</label>
            <select id="nt-column" className="input" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-assignee">Asignada a</label>
            <select id="nt-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Sin asignar</option>
              {board.users.map((u) => <option key={u.id} value={u.id}>{u.id === board.currentUserId ? `${u.name} (yo)` : u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-due">Fecha límite (opcional)</label>
            <input id="nt-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="nt-deliverable">Entregable (opcional)</label>
            <select id="nt-deliverable" className="input" value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}>
              <option value="">Sin entregable</option>
              {board.deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="nt-desc">Descripción (Markdown, opcional · @persona para avisar)</label>
          <MentionTextarea id="nt-desc" className="input field-sizing-content min-h-20" value={description} onValueChange={setDescription} users={board.users} maxLength={20000} />
        </div>
        <div>
          <div className="label">Capturas</div>
          <div className="flex flex-wrap gap-2">
            {previews.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-20 w-28 rounded-lg border border-slate-200 object-cover dark:border-slate-700" />
                <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-900 p-0.5 text-white" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} aria-label="Quitar imagen">
                  <X size={13} />
                </button>
              </div>
            ))}
            <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 dark:border-slate-700">
              <ImagePlus size={18} /> Archivo
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addFiles(imageFilesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
            <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 sm:hidden dark:border-slate-700">
              <Camera size={18} /> Cámara
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { addFiles(imageFilesFrom(e.target.files)); e.target.value = ""; }} />
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-500 max-sm:hidden">También puedes pegar una captura con Ctrl+V / ⌘+V.</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} Crear tarea
          </button>
        </div>
      </form>
    </Modal>
  );
}
