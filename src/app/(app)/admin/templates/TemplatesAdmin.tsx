"use client";

import { ArrowDown, ArrowUp, Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplate, saveTemplate, templateFromProject } from "@/actions/templates";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { COLUMN_ROLES, PALETTE, type ColumnRoleValue } from "@/lib/constants";
import { MAX_TEMPLATE_COLUMNS, MAX_TEMPLATE_KINDS, MAX_TEMPLATE_LABELS, summarizeTemplate, type TemplateDto, type TemplateInput } from "@/lib/project-templates";

const KIND_COLORS = [...PALETTE, "#84cc16", "#06b6d4", "#d946ef", "#78716c"];
const ROLE_LABEL: Record<ColumnRoleValue, string> = { NONE: "Ninguno", NEXT_RELEASE: "Siguiente salto", IN_PRODUCTION: "En producción" };

type Draft = {
  name: string;
  description: string;
  columns: { name: string; role: ColumnRoleValue; isDone: boolean }[];
  kinds: { name: string; color: string; titleTemplate: string; descriptionTemplate: string }[];
  hiddenGeneralKinds: string[];
  labels: { name: string; color: (typeof PALETTE)[number] }[];
};

const EMPTY: Draft = {
  name: "",
  description: "",
  columns: [{ name: "", role: "NONE", isDone: false }],
  kinds: [],
  hiddenGeneralKinds: [],
  labels: [],
};

function ColorField({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("h-6 w-6 rounded-full", value.toLowerCase() === c && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900")}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
        />
      ))}
      {colors.length > PALETTE.length && (
        <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" title="Otro color">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Elegir otro color" />
        </label>
      )}
    </div>
  );
}

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  const tmp = copy[i];
  copy[i] = copy[j]!;
  copy[j] = tmp!;
  return copy;
}

interface Props {
  templates: TemplateDto[];
  generalKinds: string[];
  projects: { id: string; name: string }[];
}

export function TemplatesAdmin({ templates, generalKinds, projects }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<TemplateDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [sourceId, setSourceId] = useState("");

  const draft = editing?.draft;
  const patch = (p: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));

  const toDraft = (t: TemplateInput): Draft => ({
    name: t.name,
    description: t.description ?? "",
    columns: t.columns,
    kinds: (t.kinds ?? []).map((k) => ({ name: k.name, color: k.color, titleTemplate: k.titleTemplate ?? "", descriptionTemplate: k.descriptionTemplate ?? "" })),
    hiddenGeneralKinds: t.hiddenGeneralKinds,
    labels: t.labels,
  });

  const save = () => {
    if (!editing) return;
    start(async () => {
      const res = await saveTemplate(editing.draft, editing.id);
      if (!res.ok) return toast(res.error, "error");
      toast(editing.id ? "Plantilla actualizada" : "Plantilla creada");
      setEditing(null);
      router.refresh();
    });
  };

  const fromProject = () => {
    start(async () => {
      const res = await templateFromProject(sourceId);
      if (!res.ok) return toast(res.error, "error");
      setPicking(false);
      setEditing({ id: null, draft: toDraft(res.data) });
    });
  };

  const remove = () => {
    if (!deleting) return;
    start(async () => {
      const res = await deleteTemplate(deleting.id);
      if (!res.ok) return toast(res.error, "error");
      toast("Plantilla borrada");
      setDeleting(null);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Plantillas de proyecto</h2>
        <p className="text-sm text-slate-500">
          Columnas, tipos de tarea y etiquetas con los que arranca un proyecto nuevo. Se eligen al crear el proyecto.
        </p>
      </div>

      {templates.length > 0 && (
        <ul className="card mb-3 divide-y divide-slate-200 dark:divide-slate-800">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name}</div>
                {t.description && <div className="truncate text-sm text-slate-500">{t.description}</div>}
                <div className="text-xs text-slate-500">{summarizeTemplate(t)}</div>
              </div>
              <div className="ml-auto flex items-center">
                <button className="btn-icon" onClick={() => setEditing({ id: t.id, draft: toDraft(t) })} aria-label={`Editar ${t.name}`}><Pencil size={15} /></button>
                <button className="btn-icon hover:text-red-600" onClick={() => setDeleting(t)} aria-label={`Borrar ${t.name}`}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {templates.length === 0 && <p className="mb-3 text-sm text-slate-500">Aún no hay plantillas.</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setEditing({ id: null, draft: EMPTY })}><Plus size={16} /> Nueva plantilla</button>
        <button className="btn-secondary" onClick={() => { setSourceId(projects[0]?.id ?? ""); setPicking(true); }} disabled={projects.length === 0}>
          <Copy size={15} /> Crear desde un proyecto…
        </button>
      </div>

      {picking && (
        <Modal open onClose={() => setPicking(false)} title="Crear desde un proyecto" size="sm">
          <div className="space-y-3">
            <p className="text-sm">Se copiarán sus columnas, tipos propios, tipos generales ocultos y etiquetas.</p>
            <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Proyecto">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPicking(false)}>Cancelar</button>
              <button className="btn-primary" disabled={pending || !sourceId} onClick={fromProject}>Continuar</button>
            </div>
          </div>
        </Modal>
      )}

      {editing && draft && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? "Editar plantilla" : "Nueva plantilla"}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}><X size={15} /> Cancelar</button>
              <button type="submit" form="template-form" className="btn-primary" disabled={pending || !draft.name.trim()}><Check size={15} /> Guardar</button>
            </>
          }
        >
          <form id="template-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="tpl-name">Nombre</label>
                <input id="tpl-name" className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={80} required data-autofocus />
              </div>
              <div>
                <label className="label" htmlFor="tpl-desc">Descripción</label>
                <input id="tpl-desc" className="input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} maxLength={500} />
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Columnas</h3>
              <ul className="space-y-2">
                {draft.columns.map((c, i) => {
                  const setCol = (p: Partial<typeof c>) => patch({ columns: draft.columns.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  const taken = (r: ColumnRoleValue) => r !== "NONE" && draft.columns.some((x, j) => j !== i && x.role === r);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <input className="input min-w-0 flex-1 basis-40" value={c.name} onChange={(e) => setCol({ name: e.target.value })} maxLength={80} placeholder="Nombre" aria-label={`Nombre de la columna ${i + 1}`} />
                      <select className="input w-auto" value={c.role} onChange={(e) => setCol({ role: e.target.value as ColumnRoleValue })} aria-label="Rol especial">
                        {COLUMN_ROLES.map((r) => <option key={r} value={r} disabled={taken(r)}>{ROLE_LABEL[r]}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={c.isDone} onChange={(e) => setCol({ isDone: e.target.checked })} /> Cuenta como terminada
                      </label>
                      <button type="button" className="btn-icon" disabled={i === 0} onClick={() => patch({ columns: move(draft.columns, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                      <button type="button" className="btn-icon" disabled={i === draft.columns.length - 1} onClick={() => patch({ columns: move(draft.columns, i, 1) })} aria-label="Bajar"><ArrowDown size={15} /></button>
                      <button type="button" className="btn-icon hover:text-red-600" disabled={draft.columns.length <= 1} onClick={() => patch({ columns: draft.columns.filter((_, j) => j !== i) })} aria-label="Quitar columna"><Trash2 size={15} /></button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.columns.length >= MAX_TEMPLATE_COLUMNS} onClick={() => patch({ columns: [...draft.columns, { name: "", role: "NONE", isDone: false }] })}>
                <Plus size={15} /> Añadir columna
              </button>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Tipos de tarea propios del proyecto</h3>
              <ul className="space-y-3">
                {draft.kinds.map((k, i) => {
                  const setKind = (p: Partial<typeof k>) => patch({ kinds: draft.kinds.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <li key={i} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <input className="input min-w-0 flex-1" value={k.name} onChange={(e) => setKind({ name: e.target.value })} maxLength={40} placeholder="Nombre" aria-label={`Nombre del tipo ${i + 1}`} />
                        <button type="button" className="btn-icon" disabled={i === 0} onClick={() => patch({ kinds: move(draft.kinds, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                        <button type="button" className="btn-icon" disabled={i === draft.kinds.length - 1} onClick={() => patch({ kinds: move(draft.kinds, i, 1) })} aria-label="Bajar"><ArrowDown size={15} /></button>
                        <button type="button" className="btn-icon hover:text-red-600" onClick={() => patch({ kinds: draft.kinds.filter((_, j) => j !== i) })} aria-label="Quitar tipo"><Trash2 size={15} /></button>
                      </div>
                      <ColorField value={k.color} onChange={(color) => setKind({ color })} colors={KIND_COLORS} />
                      <input className="input" value={k.titleTemplate} onChange={(e) => setKind({ titleTemplate: e.target.value })} maxLength={200} placeholder="Título automático (opcional)" aria-label="Título automático" />
                      <textarea className="input" rows={2} value={k.descriptionTemplate} onChange={(e) => setKind({ descriptionTemplate: e.target.value })} maxLength={5000} placeholder="Texto inicial de la descripción (opcional)" aria-label="Texto inicial de la descripción" />
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.kinds.length >= MAX_TEMPLATE_KINDS} onClick={() => patch({ kinds: [...draft.kinds, { name: "", color: "#6366f1", titleTemplate: "", descriptionTemplate: "" }] })}>
                <Plus size={15} /> Añadir tipo
              </button>
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold">Tipos generales que no se usarán</h3>
              <p className="mb-2 text-xs text-slate-500">Marca los generales que el proyecto ocultará. Si no hay tipos propios siempre quedará al menos uno visible.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {generalKinds.map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.hiddenGeneralKinds.includes(name)}
                      onChange={(e) => patch({ hiddenGeneralKinds: e.target.checked ? [...draft.hiddenGeneralKinds, name] : draft.hiddenGeneralKinds.filter((n) => n !== name) })}
                    />
                    {name}
                  </label>
                ))}
                {/* Nombres guardados que ya no existen como tipo general: se pueden desmarcar. */}
                {draft.hiddenGeneralKinds.filter((n) => !generalKinds.includes(n)).map((name) => (
                  <label key={name} className="flex items-center gap-1.5 text-sm text-slate-500">
                    <input type="checkbox" checked onChange={() => patch({ hiddenGeneralKinds: draft.hiddenGeneralKinds.filter((n) => n !== name) })} />
                    {name} (ya no existe)
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Etiquetas</h3>
              <ul className="space-y-2">
                {draft.labels.map((l, i) => {
                  const setLabel = (p: Partial<typeof l>) => patch({ labels: draft.labels.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <input className="input min-w-0 flex-1 basis-40" value={l.name} onChange={(e) => setLabel({ name: e.target.value })} maxLength={40} placeholder="Nombre" aria-label={`Nombre de la etiqueta ${i + 1}`} />
                      <ColorField value={l.color} onChange={(color) => setLabel({ color: color as typeof l.color })} colors={PALETTE} />
                      <button type="button" className="btn-icon hover:text-red-600" onClick={() => patch({ labels: draft.labels.filter((_, j) => j !== i) })} aria-label="Quitar etiqueta"><Trash2 size={15} /></button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.labels.length >= MAX_TEMPLATE_LABELS} onClick={() => patch({ labels: [...draft.labels, { name: "", color: PALETTE[0] }] })}>
                <Plus size={15} /> Añadir etiqueta
              </button>
            </section>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Borrar «${deleting.name}»`} size="sm">
          <div className="space-y-3">
            <p className="text-sm">Los proyectos ya creados con esta plantilla no cambian.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancelar</button>
              <button className="btn-danger" disabled={pending} onClick={remove}>Borrar plantilla</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
