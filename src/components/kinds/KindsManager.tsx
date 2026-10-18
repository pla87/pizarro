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

export interface KindRow {
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

interface Props {
  kinds: KindRow[];
  /** Tipos exclusivos de este proyecto; sin él, tipos generales. */
  projectId?: string;
  /** Otros tipos a los que se pueden pasar las tareas al borrar (los generales, en un proyecto). */
  otherKinds?: { id: string; name: string }[];
  /** Dentro de otra tarjeta (ajustes del proyecto). */
  embedded?: boolean;
}

export function KindsManager({ kinds, projectId, otherKinds = [], embedded = false }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", color: "#6366f1" });
  const [deleting, setDeleting] = useState<KindRow | null>(null);
  const [replacement, setReplacement] = useState("");
  // Los generales no se pueden quedar a cero; los de proyecto sí.
  const canDelete = !!projectId || kinds.length > 1;
  const targets = (k: KindRow) => [...otherKinds, ...kinds.filter((x) => x.id !== k.id)];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error ?? "Error", "error");
      toast(ok);
      after?.();
      router.refresh();
    });

  return (
    <div>
      {kinds.length > 0 && (
        <ul className={cn("divide-y divide-slate-200 dark:divide-slate-800", !embedded && "card")}>
          {kinds.map((k, i) => (
            <li key={k.id} className={cn("flex items-center gap-3", embedded ? "py-2" : "px-4 py-3")}>
              <TypeBadge kind={k} />
              <span className="text-xs text-slate-500">{k.taskCount} tarea(s)</span>
              <div className="ml-auto flex items-center">
                <button className="btn-icon" disabled={i === 0 || pending} onClick={() => run(() => moveKind(k.id, -1), "Orden actualizado")} aria-label="Subir"><ArrowUp size={15} /></button>
                <button className="btn-icon" disabled={i === kinds.length - 1 || pending} onClick={() => run(() => moveKind(k.id, 1), "Orden actualizado")} aria-label="Bajar"><ArrowDown size={15} /></button>
                <button className="btn-icon" onClick={() => { setEditing(k.id); setForm({ name: k.name, color: k.color }); }} aria-label={`Editar ${k.name}`}><Pencil size={15} /></button>
                <button
                  className="btn-icon hover:text-red-600"
                  disabled={!canDelete}
                  onClick={() => { setDeleting(k); setReplacement(targets(k)[0]?.id ?? ""); }}
                  aria-label={`Borrar ${k.name}`}
                  title={canDelete ? undefined : "Debe quedar al menos un tipo"}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className={cn("btn-primary", kinds.length > 0 && "mt-3")} onClick={() => { setEditing("new"); setForm({ name: "", color: "#6366f1" }); }}>
        <Plus size={16} /> Nuevo tipo
      </button>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === "new" ? "Nuevo tipo de tarea" : "Editar tipo de tarea"}
          size="sm"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}><X size={15} /> Cancelar</button>
              <button type="submit" form="kind-form" className="btn-primary" disabled={pending || !form.name.trim()}><Check size={15} /> Guardar</button>
            </>
          }
        >
          <form
            id="kind-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => (editing === "new" ? createKind(form, projectId ?? null) : updateKind(editing, form)),
                editing === "new" ? "Tipo creado" : "Tipo actualizado",
                () => setEditing(null),
              );
            }}
          >
            <div>
              <label className="label" htmlFor="kind-name">Nombre</label>
              <input id="kind-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required data-autofocus />
            </div>
            <div>
              <div className="label">Color</div>
              <ColorField value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Vista previa:</span>
              <TypeBadge kind={{ name: form.name || "Nombre", color: form.color }} />
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Borrar «${deleting.name}»`} size="sm">
          <div className="space-y-3">
            <p className="text-sm">
              {deleting.taskCount ? `Sus ${deleting.taskCount} tarea(s) pasarán al tipo:` : "No tiene tareas. Elige igualmente el tipo de destino:"}
            </p>
            <select className="input" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Tipo de destino">
              {targets(deleting).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
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
