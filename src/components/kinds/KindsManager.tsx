"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { createKind, deleteKind, moveKind, updateKind } from "@/actions/kinds";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { PALETTE } from "@/lib/constants";
import { describeKindAutomation } from "@/lib/kinds-special";

export interface KindRow {
  id: string;
  name: string;
  color: string;
  taskCount: number;
  titleTemplate: string;
  descriptionTemplate: string;
}

const EMPTY_FORM = { name: "", color: "#6366f1", titleTemplate: "", descriptionTemplate: "" };
const COLORS = [...PALETTE, "#84cc16", "#06b6d4", "#d946ef", "#78716c"];

function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("h-7 w-7 rounded-full", value.toLowerCase() === c && "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900")}
          style={{ backgroundColor: c }}
          aria-label={t("Color {name}", { name: c })}
        />
      ))}
      <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" title={t("Otro color")}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={t("Elegir otro color")} />
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
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleting, setDeleting] = useState<KindRow | null>(null);
  const [replacement, setReplacement] = useState("");
  // Los generales no se pueden quedar a cero; los de proyecto sí.
  const canDelete = !!projectId || kinds.length > 1;
  const targets = (k: KindRow) => [...otherKinds, ...kinds.filter((x) => x.id !== k.id)];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error ?? t("Error"), "error");
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
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <TypeBadge kind={k} />
                  <span className="text-xs text-slate-500">{t("{n} tarea(s)", { n: k.taskCount })}</span>
                </div>
                {describeKindAutomation(k, t) && <p className="mt-1 text-xs text-slate-500">{describeKindAutomation(k, t)}</p>}
              </div>
              <div className="ml-auto flex items-center">
                <button className="btn-icon" disabled={i === 0 || pending} onClick={() => run(() => moveKind(k.id, -1), t("Orden actualizado"))} aria-label={t("Subir")}><ArrowUp size={15} /></button>
                <button className="btn-icon" disabled={i === kinds.length - 1 || pending} onClick={() => run(() => moveKind(k.id, 1), t("Orden actualizado"))} aria-label={t("Bajar")}><ArrowDown size={15} /></button>
                <button className="btn-icon" onClick={() => { setEditing(k.id); setForm({ name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate }); }} aria-label={t("Editar {name}", { name: k.name })}><Pencil size={15} /></button>
                <button
                  className="btn-icon hover:text-red-600"
                  disabled={!canDelete}
                  onClick={() => { setDeleting(k); setReplacement(targets(k)[0]?.id ?? ""); }}
                  aria-label={t("Borrar {name}", { name: k.name })}
                  title={canDelete ? undefined : t("Debe quedar al menos un tipo")}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className={cn("btn-primary", kinds.length > 0 && "mt-3")} onClick={() => { setEditing("new"); setForm(EMPTY_FORM); }}>
        <Plus size={16} /> {t("Nuevo tipo")}
      </button>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === "new" ? t("Nuevo tipo de tarea") : t("Editar tipo de tarea")}
          size="sm"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}><X size={15} /> {t("Cancelar")}</button>
              <button type="submit" form="kind-form" className="btn-primary" disabled={pending || !form.name.trim()}><Check size={15} /> {t("Guardar")}</button>
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
                editing === "new" ? t("Tipo creado") : t("Tipo actualizado"),
                () => setEditing(null),
              );
            }}
          >
            <div>
              <label className="label" htmlFor="kind-name">{t("Nombre")}</label>
              <input id="kind-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required data-autofocus />
            </div>
            <div>
              <div className="label">{t("Color")}</div>
              <ColorField value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t("Vista previa:")}</span>
              <TypeBadge kind={{ name: form.name || t("Nombre"), color: form.color }} />
            </div>
            <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <h3 className="text-sm font-semibold">{t("Automatización (opcional)")}</h3>
              <div>
                <label className="label" htmlFor="kind-title-tpl">{t("Título automático")}</label>
                <input id="kind-title-tpl" className="input" value={form.titleTemplate} onChange={(e) => setForm({ ...form, titleTemplate: e.target.value })} maxLength={200} />
              </div>
              <div>
                <label className="label" htmlFor="kind-desc-tpl">{t("Texto inicial de la descripción")}</label>
                <textarea id="kind-desc-tpl" className="input min-h-20" value={form.descriptionTemplate} onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })} maxLength={2000} rows={3} />
              </div>
              <p className="text-xs text-slate-500">{t("Al elegir este tipo en una tarea se rellenan solos el título y el comienzo de la descripción.")}</p>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={t("Borrar «{name}»", { name: deleting.name })} size="sm">
          <div className="space-y-3">
            <p className="text-sm">
              {deleting.taskCount ? t("Sus {n} tarea(s) pasarán al tipo:", { n: deleting.taskCount }) : t("No tiene tareas. Elige igualmente el tipo de destino:")}
            </p>
            <select className="input" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label={t("Tipo de destino")}>
              {targets(deleting).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>{t("Cancelar")}</button>
              <button className="btn-danger" disabled={pending || !replacement} onClick={() => run(() => deleteKind(deleting.id, replacement), t("Tipo borrado"), () => setDeleting(null))}>
                {t("Borrar tipo")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
