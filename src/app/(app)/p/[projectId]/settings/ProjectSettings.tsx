"use client";

import { ArchiveRestore, CalendarClock, Check, Lock, Pencil, Plus, Trash2, Users as UsersIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createDeliverable, createLabel, deleteDeliverable, deleteLabel, deleteProject, setProjectVisibility, updateDeliverable, updateLabel, updateProject,
} from "@/actions/projects";
import { formatDay } from "@/lib/dates";
import { restoreTask } from "@/actions/tasks";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/Toast";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { PALETTE, type TaskTypeValue } from "@/lib/constants";
import type { LabelOption } from "@/lib/types";

interface Props {
  isAdmin: boolean;
  project: { id: string; name: string; description: string; restricted: boolean; memberIds: string[] };
  labels: LabelOption[];
  deliverables: DeliverableRow[];
  archived: { id: string; title: string; type: TaskTypeValue; archivedAt: string }[];
  users: { id: string; name: string; role: "ADMIN" | "MEMBER" }[];
}

function Section({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProjectSettings({ isAdmin, project, deliverables, labels: initialLabels, archived: initialArchived, users }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [restricted, setRestricted] = useState(project.restricted);
  const [members, setMembers] = useState(new Set(project.memberIds));
  const [labels, setLabels] = useState(initialLabels);
  const [archived, setArchived] = useState(initialArchived);
  const [confirmName, setConfirmName] = useState("");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error, "error");
      toast(success);
      after?.();
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Ajustes del proyecto</h1>

      {isAdmin && (
        <Section title="General">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => updateProject(project.id, { name, description }), "Proyecto actualizado", () => router.refresh());
            }}
          >
            <div>
              <label className="label" htmlFor="p-name">Nombre</label>
              <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div>
              <label className="label" htmlFor="p-desc">Descripción</label>
              <textarea id="p-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
            <button className="btn-primary" disabled={pending}>Guardar</button>
          </form>
        </Section>
      )}

      {isAdmin && (
        <Section title="Visibilidad" description="Por defecto todos los usuarios ven el proyecto. Puedes limitarlo a usuarios concretos (los administradores siempre lo ven).">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={!restricted} onChange={() => setRestricted(false)} />
              <UsersIcon size={15} /> Visible para todos los usuarios
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={restricted} onChange={() => setRestricted(true)} />
              <Lock size={15} /> Solo los usuarios seleccionados
            </label>
          </div>
          {restricted && (
            <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {users.map((u) => (
                <li key={u.id}>
                  <label className={cn("flex items-center gap-3 px-3 py-2 text-sm", u.role === "ADMIN" && "opacity-60")}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      disabled={u.role === "ADMIN"}
                      checked={u.role === "ADMIN" || members.has(u.id)}
                      onChange={() =>
                        setMembers((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        })
                      }
                    />
                    {u.name}
                    {u.role === "ADMIN" && <span className="text-xs text-slate-500">(administrador, siempre tiene acceso)</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn-primary mt-4"
            disabled={pending}
            onClick={() => run(() => setProjectVisibility(project.id, restricted, [...members]), "Visibilidad actualizada", () => router.refresh())}
          >
            Guardar visibilidad
          </button>
        </Section>
      )}

      <Section
        id="deliverables"
        title="Entregables"
        description="Hitos con fecha objetivo que agrupan tarjetas. Se asignan desde el detalle de cada tarjeta y aparecen en el informe PDF."
      >
        <Deliverables projectId={project.id} initial={deliverables} />
      </Section>

      <Section id="labels" title="Etiquetas" description="Etiquetas propias de este proyecto para clasificar tarjetas.">
        <ul className="space-y-1.5">
          {labels.map((l) => (
            <LabelRow
              key={l.id}
              label={l}
              onSaved={(next) => setLabels((ls) => ls.map((x) => (x.id === next.id ? next : x)))}
              onDeleted={() => setLabels((ls) => ls.filter((x) => x.id !== l.id))}
            />
          ))}
          {labels.length === 0 && <li className="text-sm text-slate-500">No hay etiquetas.</li>}
        </ul>
        <NewLabel projectId={project.id} onCreated={(l) => setLabels((ls) => [...ls, l].sort((a, b) => a.name.localeCompare(b.name)))} />
      </Section>

      <Section title="Columnas" description="Las columnas se crean, renombran, reordenan, cambian de rol y borran (si están vacías) desde el menú «⋯» de cada columna en el tablero." >
        <p className="text-sm text-slate-500">
          El rol <strong>Siguiente salto</strong> muestra el botón «Generar Release»; el rol <strong>En producción</strong> es el destino de las tarjetas al marcar una release como desplegada.
        </p>
      </Section>

      <Section title="Tarjetas archivadas" description="Las tarjetas archivadas no aparecen en el tablero. Puedes restaurarlas a su columna.">
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {archived.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <TypeBadge type={t.type} />
              <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
              <span className="text-xs text-slate-500 max-sm:hidden">{new Date(t.archivedAt).toLocaleDateString("es-ES")}</span>
              <button
                className="btn-ghost py-1 text-xs"
                onClick={() => run(() => restoreTask(t.id), "Tarjeta restaurada", () => setArchived((a) => a.filter((x) => x.id !== t.id)))}
              >
                <ArchiveRestore size={14} /> Restaurar
              </button>
            </li>
          ))}
          {archived.length === 0 && <li className="py-2 text-sm text-slate-500">No hay tarjetas archivadas.</li>}
        </ul>
      </Section>

      {isAdmin && (
        <Section title="Borrar proyecto" description="Borra el proyecto con todas sus columnas, tarjetas, adjuntos y releases. No se puede deshacer.">
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              placeholder={`Escribe «${project.name}» para confirmar`}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <button
              className="btn-danger"
              disabled={pending || confirmName !== project.name}
              onClick={() => run(() => deleteProject(project.id, confirmName), "Proyecto borrado", () => { router.push("/"); router.refresh(); })}
            >
              <Trash2 size={15} /> Borrar proyecto
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function LabelRow({ label, onSaved, onDeleted }: { label: LabelOption; onSaved: (l: LabelOption) => void; onDeleted: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string | null>(label.color);

  if (!editing) {
    return (
      <li className="flex items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: label.color }}>{label.name}</span>
        <button className="btn-icon ml-auto h-7 w-7" onClick={() => setEditing(true)} aria-label="Editar etiqueta"><Pencil size={14} /></button>
        <button
          className="btn-icon h-7 w-7 hover:text-red-600"
          aria-label="Borrar etiqueta"
          onClick={async () => {
            if (!window.confirm(`¿Borrar la etiqueta «${label.name}»? Se quitará de todas las tarjetas.`)) return;
            const res = await deleteLabel(label.id);
            if (!res.ok) return toast(res.error, "error");
            onDeleted();
          }}
        >
          <Trash2 size={14} />
        </button>
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      <ColorPicker value={color} onChange={setColor} allowNone={false} />
      <div className="flex gap-2">
        <button
          className="btn-primary py-1.5"
          onClick={async () => {
            const res = await updateLabel(label.id, { name, color: color ?? PALETTE[0] });
            if (!res.ok) return toast(res.error, "error");
            onSaved({ id: label.id, name: name.trim(), color: color ?? PALETTE[0] });
            setEditing(false);
          }}
        >
          <Check size={15} /> Guardar
        </button>
        <button className="btn-ghost py-1.5" onClick={() => setEditing(false)}><X size={15} /> Cancelar</button>
      </div>
    </li>
  );
}

function NewLabel({ projectId, onCreated }: { projectId: string; onCreated: (l: LabelOption) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(PALETTE[6]);
  return (
    <form
      className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await createLabel(projectId, { name, color: color ?? PALETTE[0] });
        if (!res.ok) return toast(res.error, "error");
        onCreated(res.data);
        setName("");
      }}
    >
      <div className="flex gap-2">
        <input className="input" placeholder="Nueva etiqueta" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn-secondary shrink-0" disabled={!name.trim()}><Plus size={15} /> Añadir</button>
      </div>
      <ColorPicker value={color} onChange={setColor} allowNone={false} />
    </form>
  );
}

interface DeliverableRow {
  id: string;
  name: string;
  description: string;
  dueDate: string | null;
  taskCount: number;
}

function Deliverables({ projectId, initial }: { projectId: string; initial: DeliverableRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", dueDate: "" });
  const [pending, start] = useTransition();

  const reset = () => {
    setEditing(null);
    setForm({ name: "", description: "", dueDate: "" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name: form.name, description: form.description, dueDate: form.dueDate || null };
    start(async () => {
      if (editing) {
        const res = await updateDeliverable(editing, input);
        if (!res.ok) return toast(res.error, "error");
        setRows((r) => r.map((d) => (d.id === editing ? { ...d, ...input, name: input.name.trim() } : d)));
        toast("Entregable actualizado");
      } else {
        const res = await createDeliverable(projectId, input);
        if (!res.ok) return toast(res.error, "error");
        setRows((r) => [...r, { ...res.data, taskCount: 0 }]);
        toast("Entregable creado");
      }
      reset();
      router.refresh();
    });
  };

  return (
    <div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {rows.map((d) => (
          <li key={d.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{d.name}</div>
              <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {d.dueDate ? formatDay(d.dueDate) : "Sin fecha"}</span>
                <span>{d.taskCount} tarjeta(s)</span>
              </div>
              {d.description && <p className="mt-0.5 text-xs text-slate-500">{d.description}</p>}
            </div>
            <button
              className="btn-icon h-7 w-7"
              aria-label="Editar entregable"
              onClick={() => {
                setEditing(d.id);
                setForm({ name: d.name, description: d.description, dueDate: d.dueDate ?? "" });
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="btn-icon h-7 w-7 hover:text-red-600"
              aria-label="Borrar entregable"
              onClick={async () => {
                if (!window.confirm(`¿Borrar el entregable «${d.name}»? Sus tarjetas se conservan, sin entregable.`)) return;
                const res = await deleteDeliverable(d.id);
                if (!res.ok) return toast(res.error, "error");
                setRows((r) => r.filter((x) => x.id !== d.id));
                router.refresh();
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-sm text-slate-500">No hay entregables.</li>}
      </ul>
      <form onSubmit={submit} className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_10rem] dark:border-slate-800">
        <input className="input" placeholder={editing ? "Nombre" : "Nuevo entregable (p. ej. «Beta cerrada»)"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required />
        <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} aria-label="Fecha objetivo" />
        <input className="input sm:col-span-2" placeholder="Descripción (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={pending || !form.name.trim()}>
            {editing ? <><Check size={15} /> Guardar</> : <><Plus size={15} /> Añadir entregable</>}
          </button>
          {editing && <button type="button" className="btn-ghost" onClick={reset}>Cancelar</button>}
        </div>
      </form>
    </div>
  );
}
