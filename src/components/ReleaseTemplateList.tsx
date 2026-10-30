"use client";

import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { TemplateOption } from "@/lib/types";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Qué hace cada botón: las plantillas del usuario y las del proyecto usan la misma lista con acciones distintas. */
export interface ReleaseTemplateActions {
  create: (kind: "HEADER" | "FOOTER", input: { name: string; content: string }) => Promise<Result<TemplateOption>>;
  update: (id: string, input: { name: string; content: string }) => Promise<Result>;
  move: (id: string, direction: -1 | 1) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
}

/** Lista editable de cabeceras o pies de release (alta, edición con vista previa, orden y borrado). */
export function ReleaseTemplateList({ kind, title, initial, placeholder, actions, showDefault = true }: { kind: "HEADER" | "FOOTER"; title: string; initial: TemplateOption[]; placeholder: string; actions: ReleaseTemplateActions; /** Marca la primera como «Por defecto» (solo las del usuario: las del proyecto no se eligen solas). */ showDefault?: boolean }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "" });
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();

  // Sube/baja una plantilla; la primera es la que «Generar release» elige por defecto.
  const move = (id: string, dir: -1 | 1) =>
    start(async () => {
      const index = items.findIndex((x) => x.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= items.length) return;
      const previous = items;
      const next = items.slice();
      [next[index], next[target]] = [next[target]!, next[index]!];
      setItems(next);
      const res = await actions.move(id, dir);
      if (!res.ok) {
        setItems(previous);
        toast(res.error, "error");
      }
    });

  const open = (tpl?: TemplateOption) => {
    setEditing(tpl ? tpl.id : "new");
    setForm(tpl ? { name: tpl.name, content: tpl.content } : { name: "", content: "" });
    setPreview(false);
  };

  const save = () =>
    start(async () => {
      if (editing === "new") {
        const res = await actions.create(kind, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => [...l, res.data]);
      } else if (editing) {
        const res = await actions.update(editing, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => l.map((x) => (x.id === editing ? { ...x, name: form.name.trim(), content: form.content } : x)));
      }
      setEditing(null);
      toast(t("Plantilla guardada"));
    });

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {editing === null && (
          <button className="btn-ghost py-1 text-xs" onClick={() => open()}>
            <Plus size={14} /> {t("Añadir")}
          </button>
        )}
      </div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((tpl, i) => (
          <li key={tpl.id} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {tpl.name}
                {showDefault && i === 0 && items.length > 1 && <span className="badge bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/40">{t("Por defecto")}</span>}
              </div>
              <p className="line-clamp-2 font-mono text-xs whitespace-pre-wrap text-slate-500">{tpl.content || t("(vacía)")}</p>
            </div>
            {items.length > 1 && (
              <>
                <button className="btn-icon h-7 w-7" disabled={i === 0 || pending} onClick={() => move(tpl.id, -1)} aria-label={t("Subir {name}", { name: tpl.name })}><ArrowUp size={14} /></button>
                <button className="btn-icon h-7 w-7" disabled={i === items.length - 1 || pending} onClick={() => move(tpl.id, 1)} aria-label={t("Bajar {name}", { name: tpl.name })}><ArrowDown size={14} /></button>
              </>
            )}
            <button className="btn-icon h-7 w-7" onClick={() => open(tpl)} aria-label={t("Editar {name}", { name: tpl.name })}><Pencil size={14} /></button>
            <button
              className="btn-icon h-7 w-7 hover:text-red-600"
              aria-label={t("Borrar {name}", { name: tpl.name })}
              onClick={async () => {
                if (!(await confirm({ title: t("Borrar plantilla"), message: t("¿Borrar «{name}»?", { name: tpl.name }), confirmLabel: t("Borrar"), danger: true }))) return;
                const res = await actions.remove(tpl.id);
                if (!res.ok) return toast(res.error, "error");
                setItems((l) => l.filter((x) => x.id !== tpl.id));
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{t("Ninguna todavía.")}</li>}
      </ul>
      {editing !== null && (
        <div className="mt-3 space-y-2 rounded-lg border border-brand-500/40 p-3">
          <input className="input" placeholder={t("Nombre (p. ej. «Para el equipo de negocio»)")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} autoFocus />
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
            {[false, true].map((p) => (
              <button
                key={String(p)}
                onClick={() => setPreview(p)}
                className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium", preview === p ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
              >
                {p ? <><Eye size={13} /> {t("Vista previa")}</> : <><Pencil size={13} /> {t("Editar")}</>}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="min-h-24 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><Markdown>{form.content}</Markdown></div>
          ) : (
            <textarea className="input field-sizing-content min-h-28 font-mono text-[13px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} maxLength={20000} placeholder={placeholder} />
          )}
          <div className="flex gap-2">
            <button className="btn-primary py-1.5" onClick={save} disabled={pending || !form.name.trim()}><Check size={15} /> {t("Guardar")}</button>
            <button className="btn-ghost py-1.5" onClick={() => setEditing(null)}><X size={15} /> {t("Cancelar")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
