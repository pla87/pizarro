"use client";

import { ArrowDown, ArrowUp, Check, Copy, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplate, resetTemplate, restoreDefaultTemplates, saveTemplate, templateFromProject } from "@/actions/templates";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/core";
import { COLUMN_ROLES, PALETTE, type ColumnRoleValue } from "@/lib/constants";
import { parseSubtaskLines } from "@/lib/kinds-special";
import { MAX_TEMPLATE_COLUMNS, MAX_TEMPLATE_KINDS, MAX_TEMPLATE_LABELS, type TemplateDto, type TemplateInput } from "@/lib/project-templates";

const KIND_COLORS = [...PALETTE, "#84cc16", "#06b6d4", "#d946ef", "#78716c"];
const ROLE_LABEL: Record<ColumnRoleValue, string> = { NONE: "Ninguno", NEXT_RELEASE: "Siguiente salto", IN_PRODUCTION: "En producción" };

/** Resumen de una línea: «5 columnas · 2 tipos propios · 3 etiquetas · 1 general oculto». */
function summarizeTemplate(tpl: Pick<TemplateDto, "columns" | "kinds" | "labels" | "hiddenGeneralKinds">, t: T): string {
  const n = (count: number, one: string, many: string) => (count === 1 ? t(one) : t(many, { n: count }));
  const parts = [
    n(tpl.columns.length, "1 columna", "{n} columnas"),
    n(tpl.kinds.length, "1 tipo propio", "{n} tipos propios"),
    n(tpl.labels.length, "1 etiqueta", "{n} etiquetas"),
  ];
  if (tpl.hiddenGeneralKinds.length) parts.push(n(tpl.hiddenGeneralKinds.length, "1 general oculto", "{n} generales ocultos"));
  return parts.join(" · ");
}

type Draft = {
  name: string;
  description: string;
  columns: { name: string; role: ColumnRoleValue; isDone: boolean }[];
  kinds: { name: string; color: string; titleTemplate: string; descriptionTemplate: string; subtaskTemplate: string[] }[];
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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("h-6 w-6 rounded-full", value.toLowerCase() === c && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900")}
          style={{ backgroundColor: c }}
          aria-label={t("Color {c}", { c })}
        />
      ))}
      {colors.length > PALETTE.length && (
        <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500" title={t("Otro color")}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={t("Elegir otro color")} />
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
  /** Plantillas de serie que se borraron y se pueden recuperar. */
  missingBuiltins: number;
}

export function TemplatesAdmin({ templates, generalKinds, projects, missingBuiltins }: Props) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<TemplateDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [sourceId, setSourceId] = useState("");

  const draft = editing?.draft;
  const patch = (p: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));

  const toDraft = (tpl: TemplateInput): Draft => ({
    name: tpl.name,
    description: tpl.description ?? "",
    columns: tpl.columns,
    kinds: (tpl.kinds ?? []).map((k) => ({ name: k.name, color: k.color, titleTemplate: k.titleTemplate ?? "", descriptionTemplate: k.descriptionTemplate ?? "", subtaskTemplate: k.subtaskTemplate ?? [] })),
    hiddenGeneralKinds: tpl.hiddenGeneralKinds,
    labels: tpl.labels,
  });

  const save = () => {
    if (!editing) return;
    start(async () => {
      // Sin líneas vacías ni repetidas en las subtareas predefinidas.
      const body = { ...editing.draft, kinds: editing.draft.kinds.map((k) => ({ ...k, subtaskTemplate: parseSubtaskLines(k.subtaskTemplate.join("\n")) })) };
      const res = await saveTemplate(body, editing.id);
      if (!res.ok) return toast(res.error, "error");
      toast(editing.id ? t("Plantilla actualizada") : t("Plantilla creada"));
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

  const reset = async (tpl: TemplateDto) => {
    const ok = await confirm({
      title: t("Restablecer «{name}»", { name: tpl.name }),
      message: t("Se perderán los cambios hechos a esta plantilla y volverá a su contenido original. Los proyectos ya creados no cambian."),
      confirmLabel: t("Restablecer"),
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await resetTemplate(tpl.id);
      if (!res.ok) return toast(res.error, "error");
      toast(t("Plantilla restablecida"));
      router.refresh();
    });
  };

  const restoreDefaults = () => {
    start(async () => {
      const res = await restoreDefaultTemplates();
      if (!res.ok) return toast(res.error, "error");
      toast(res.data.restored === 1 ? t("1 plantilla recuperada") : t("{n} plantillas recuperadas", { n: res.data.restored }));
      router.refresh();
    });
  };

  const remove = () => {
    if (!deleting) return;
    start(async () => {
      const res = await deleteTemplate(deleting.id);
      if (!res.ok) return toast(res.error, "error");
      toast(t("Plantilla borrada"));
      setDeleting(null);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t("Plantillas de proyecto")}</h2>
        <p className="text-sm text-slate-500">
          {t("Columnas, tipos de tarea y etiquetas con los que arranca un proyecto nuevo. Se eligen al crear el proyecto.")}
        </p>
      </div>

      {templates.length > 0 && (
        <ul className="card mb-3 divide-y divide-slate-200 dark:divide-slate-800">
          {templates.map((tpl) => (
            <li key={tpl.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{tpl.name}</span>
                  {tpl.builtinKey && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("Por defecto")}</span>}
                  {tpl.builtinModified && <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">{t("modificada")}</span>}
                </div>
                {tpl.description && <div className="truncate text-sm text-slate-500">{tpl.description}</div>}
                <div className="text-xs text-slate-500">{summarizeTemplate(tpl, t)}</div>
              </div>
              <div className="ml-auto flex shrink-0 items-center">
                {tpl.builtinModified && (
                  <button className="btn-secondary mr-1" disabled={pending} onClick={() => void reset(tpl)} aria-label={t("Restablecer {name}", { name: tpl.name })}>
                    <RotateCcw size={14} /> <span className="hidden sm:inline">{t("Restablecer")}</span>
                  </button>
                )}
                <button className="btn-icon" onClick={() => setEditing({ id: tpl.id, draft: toDraft(tpl) })} aria-label={t("Editar {name}", { name: tpl.name })}><Pencil size={15} /></button>
                <button className="btn-icon hover:text-red-600" onClick={() => setDeleting(tpl)} aria-label={t("Borrar {name}", { name: tpl.name })}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {templates.length === 0 && <p className="mb-3 text-sm text-slate-500">{t("Aún no hay plantillas.")}</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setEditing({ id: null, draft: EMPTY })}><Plus size={16} /> {t("Nueva plantilla")}</button>
        <button className="btn-secondary" onClick={() => { setSourceId(projects[0]?.id ?? ""); setPicking(true); }} disabled={projects.length === 0}>
          <Copy size={15} /> {t("Crear desde un proyecto…")}
        </button>
        {missingBuiltins > 0 && (
          <button className="btn-secondary" disabled={pending} onClick={restoreDefaults}>
            <RotateCcw size={15} /> {t("Recuperar plantillas por defecto")}
          </button>
        )}
      </div>

      {picking && (
        <Modal open onClose={() => setPicking(false)} title={t("Crear desde un proyecto")} size="sm">
          <div className="space-y-3">
            <p className="text-sm">{t("Se copiarán sus columnas, tipos propios, tipos generales ocultos y etiquetas.")}</p>
            <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label={t("Proyecto")}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPicking(false)}>{t("Cancelar")}</button>
              <button className="btn-primary" disabled={pending || !sourceId} onClick={fromProject}>{t("Continuar")}</button>
            </div>
          </div>
        </Modal>
      )}

      {editing && draft && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? t("Editar plantilla") : t("Nueva plantilla")}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}><X size={15} /> {t("Cancelar")}</button>
              <button type="submit" form="template-form" className="btn-primary" disabled={pending || !draft.name.trim()}><Check size={15} /> {t("Guardar")}</button>
            </>
          }
        >
          <form id="template-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="tpl-name">{t("Nombre")}</label>
                <input id="tpl-name" className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={80} required data-autofocus />
              </div>
              <div>
                <label className="label" htmlFor="tpl-desc">{t("Descripción")}</label>
                <input id="tpl-desc" className="input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} maxLength={500} />
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Columnas")}</h3>
              <ul className="space-y-2">
                {draft.columns.map((c, i) => {
                  const setCol = (p: Partial<typeof c>) => patch({ columns: draft.columns.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  const taken = (r: ColumnRoleValue) => r !== "NONE" && draft.columns.some((x, j) => j !== i && x.role === r);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <input className="input min-w-0 flex-1 basis-40" value={c.name} onChange={(e) => setCol({ name: e.target.value })} maxLength={80} placeholder={t("Nombre")} aria-label={t("Nombre de la columna {n}", { n: i + 1 })} />
                      <select className="input w-auto" value={c.role} onChange={(e) => setCol({ role: e.target.value as ColumnRoleValue })} aria-label={t("Rol especial")}>
                        {COLUMN_ROLES.map((r) => <option key={r} value={r} disabled={taken(r)}>{t(ROLE_LABEL[r])}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={c.isDone} onChange={(e) => setCol({ isDone: e.target.checked })} /> {t("Cuenta como terminada")}
                      </label>
                      <button type="button" className="btn-icon" disabled={i === 0} onClick={() => patch({ columns: move(draft.columns, i, -1) })} aria-label={t("Subir")}><ArrowUp size={15} /></button>
                      <button type="button" className="btn-icon" disabled={i === draft.columns.length - 1} onClick={() => patch({ columns: move(draft.columns, i, 1) })} aria-label={t("Bajar")}><ArrowDown size={15} /></button>
                      <button type="button" className="btn-icon hover:text-red-600" disabled={draft.columns.length <= 1} onClick={() => patch({ columns: draft.columns.filter((_, j) => j !== i) })} aria-label={t("Quitar columna")}><Trash2 size={15} /></button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.columns.length >= MAX_TEMPLATE_COLUMNS} onClick={() => patch({ columns: [...draft.columns, { name: "", role: "NONE", isDone: false }] })}>
                <Plus size={15} /> {t("Añadir columna")}
              </button>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Tipos de tarea propios del proyecto")}</h3>
              <ul className="space-y-3">
                {draft.kinds.map((k, i) => {
                  const setKind = (p: Partial<typeof k>) => patch({ kinds: draft.kinds.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <li key={i} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <input className="input min-w-0 flex-1" value={k.name} onChange={(e) => setKind({ name: e.target.value })} maxLength={40} placeholder={t("Nombre")} aria-label={t("Nombre del tipo {n}", { n: i + 1 })} />
                        <button type="button" className="btn-icon" disabled={i === 0} onClick={() => patch({ kinds: move(draft.kinds, i, -1) })} aria-label={t("Subir")}><ArrowUp size={15} /></button>
                        <button type="button" className="btn-icon" disabled={i === draft.kinds.length - 1} onClick={() => patch({ kinds: move(draft.kinds, i, 1) })} aria-label={t("Bajar")}><ArrowDown size={15} /></button>
                        <button type="button" className="btn-icon hover:text-red-600" onClick={() => patch({ kinds: draft.kinds.filter((_, j) => j !== i) })} aria-label={t("Quitar tipo")}><Trash2 size={15} /></button>
                      </div>
                      <ColorField value={k.color} onChange={(color) => setKind({ color })} colors={KIND_COLORS} />
                      <input className="input" value={k.titleTemplate} onChange={(e) => setKind({ titleTemplate: e.target.value })} maxLength={200} placeholder={t("Título automático (opcional)")} aria-label={t("Título automático")} />
                      <textarea className="input" rows={2} value={k.descriptionTemplate} onChange={(e) => setKind({ descriptionTemplate: e.target.value })} maxLength={5000} placeholder={t("Texto inicial de la descripción (opcional)")} aria-label={t("Texto inicial de la descripción")} />
                      <textarea className="input" rows={2} value={k.subtaskTemplate.join("\n")} onChange={(e) => setKind({ subtaskTemplate: e.target.value.split("\n") })} placeholder={t("Subtareas predefinidas (una por línea, opcional)")} aria-label={t("Subtareas predefinidas")} />
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.kinds.length >= MAX_TEMPLATE_KINDS} onClick={() => patch({ kinds: [...draft.kinds, { name: "", color: "#6366f1", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }] })}>
                <Plus size={15} /> {t("Añadir tipo")}
              </button>
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold">{t("Tipos generales que no se usarán")}</h3>
              <p className="mb-2 text-xs text-slate-500">{t("Marca los generales que el proyecto ocultará. Si no hay tipos propios siempre quedará al menos uno visible.")}</p>
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
                    {t("{name} (ya no existe)", { name })}
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Etiquetas")}</h3>
              <ul className="space-y-2">
                {draft.labels.map((l, i) => {
                  const setLabel = (p: Partial<typeof l>) => patch({ labels: draft.labels.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <input className="input min-w-0 flex-1 basis-40" value={l.name} onChange={(e) => setLabel({ name: e.target.value })} maxLength={40} placeholder={t("Nombre")} aria-label={t("Nombre de la etiqueta {n}", { n: i + 1 })} />
                      <ColorField value={l.color} onChange={(color) => setLabel({ color: color as typeof l.color })} colors={PALETTE} />
                      <button type="button" className="btn-icon hover:text-red-600" onClick={() => patch({ labels: draft.labels.filter((_, j) => j !== i) })} aria-label={t("Quitar etiqueta")}><Trash2 size={15} /></button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn-secondary mt-2" disabled={draft.labels.length >= MAX_TEMPLATE_LABELS} onClick={() => patch({ labels: [...draft.labels, { name: "", color: PALETTE[0] }] })}>
                <Plus size={15} /> {t("Añadir etiqueta")}
              </button>
            </section>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={t("Borrar «{name}»", { name: deleting.name })} size="sm">
          <div className="space-y-3">
            <p className="text-sm">{t("Los proyectos ya creados con esta plantilla no cambian.")}</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>{t("Cancelar")}</button>
              <button className="btn-danger" disabled={pending} onClick={remove}>{t("Borrar plantilla")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
