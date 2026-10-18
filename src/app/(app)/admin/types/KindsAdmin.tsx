"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createKind, deleteKind, moveKind, updateKind } from "@/actions/kinds";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { PALETTE } from "@/lib/constants";

interface KindRow {
  id: string;
  name: string;
  color: string;
  taskCount: number;
}

const COLORS = [...PALETTE, "#84cc16", "#06b6d4", "#d946ef", "#78716c"];

function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("h-7 w-7 rounded-full", value.toLowerCase() === c && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900")}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
        />
      ))}
      <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" title="Otro color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Elegir otro color" />
      </label>
    </div>
  );
}

export function KindsAdmin({ kinds: initial }: { kinds: KindRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", color: "#6366f1" });
  const [deleting, setDeleting] = useState<KindRow | null>(null);
  const [replacement, setReplacement] = useState("");
  const kinds = initial;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error ?? "Error", "error");
      toast(ok);
      after?.();
      router.refresh();
    });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tipos de tarea</h1>
          <p className="text-sm text-slate-500">Cada tipo es una sección de las release notes, en este orden.</p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => { setEditing("new"); setForm({ name: "", color: "#6366f1" }); }}>
          <Plus size={16} /> Nuevo tipo
        </button>
      </div>

      {editing && (
        <form
          className="card mb-4 space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => (editing === "new" ? createKind(form) : updateKind(editing, form)),
              editing === "new" ? "Tipo creado" : "Tipo actualizado",
              () => setEditing(null),
            );
          }}
        >
          <div>
            <label className="label" htmlFor="kind-name">Nombre</label>
            <input id="kind-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required autoFocus />
          </div>
          <div>
            <div className="label">Color</div>
            <ColorField value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Vista previa:</span>
            <TypeBadge kind={{ name: form.name || "Nombre", color: form.color }} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={pending || !form.name.trim()}><Check size={15} /> Guardar</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}><X size={15} /> Cancelar</button>
          </div>
        </form>
      )}

      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {kinds.map((k, i) => (
          <li key={k.id} className="flex items-center gap-3 px-4 py-3">
            <TypeBadge kind={k} />
            <span className="text-xs text-slate-500">{k.taskCount} tarea(s)</span>
            <div className="ml-auto flex items-center">
              <button className="btn-icon" disabled={i === 0 || pending} onClick={() => run(() => moveKind(k.id, -1), "Orden actualizado")} aria-label="Subir"><ArrowUp size={15} /></button>
              <button className="btn-icon" disabled={i === kinds.length - 1 || pending} onClick={() => run(() => moveKind(k.id, 1), "Orden actualizado")} aria-label="Bajar"><ArrowDown size={15} /></button>
              <button className="btn-icon" onClick={() => { setEditing(k.id); setForm({ name: k.name, color: k.color }); }} aria-label={`Editar ${k.name}`}><Pencil size={15} /></button>
              <button
                className="btn-icon hover:text-red-600"
                disabled={kinds.length <= 1}
                onClick={() => { setDeleting(k); setReplacement(kinds.find((x) => x.id !== k.id)?.id ?? ""); }}
                aria-label={`Borrar ${k.name}`}
                title={kinds.length <= 1 ? "Debe quedar al menos un tipo" : undefined}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Borrar «${deleting.name}»`} size="sm">
          <div className="space-y-3">
            <p className="text-sm">
              {deleting.taskCount ? `Sus ${deleting.taskCount} tarea(s) pasarán al tipo:` : "No tiene tareas. Elige igualmente el tipo de destino:"}
            </p>
            <select className="input" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
              {kinds.filter((x) => x.id !== deleting.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancelar</button>
              <button className="btn-danger" disabled={pending || !replacement} onClick={() => run(() => deleteKind(deleting.id, replacement), "Tipo borrado", () => setDeleting(null))}>
                Borrar tipo
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
