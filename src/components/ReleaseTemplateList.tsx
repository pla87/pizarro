"use client";

import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { DescriptionField } from "@/components/ui/DescriptionField";
import { Markdown } from "@/components/ui/Markdown";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import type { EditorModeValue, TemplateOption } from "@/lib/types";

const NO_USERS: never[] = [];

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Qué hace cada botón: las plantillas del usuario y las del proyecto usan la misma lista con acciones distintas. */
interface ReleaseTemplateActions {
  create: (kind: "HEADER" | "FOOTER", input: { name: string; content: string }) => Promise<Result<TemplateOption>>;
  update: (id: string, input: { name: string; content: string }) => Promise<Result>;
  move: (id: string, direction: -1 | 1) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
}

/**
 * Una sola edición abierta en toda la página: las cabeceras y los pies son listas distintas, pero abrir una
 * edición cierra la otra (preguntando antes si tenía cambios sin guardar).
 */
let activeEditor: { owner: object; dirty: () => boolean; name: () => string; close: () => void } | null = null;

/**
 * Lista editable de cabeceras o pies de release (alta, edición con vista previa, orden y borrado). La edición es
 * en línea: la plantilla que se edita se convierte en la caja de edición en su sitio, y la nueva aparece al final.
 */
export function ReleaseTemplateList({ kind, title, initial, placeholder, actions, showDefault = true, editorMode = "MARKDOWN" }: { editorMode?: EditorModeValue; kind: "HEADER" | "FOOTER"; title: string; initial: TemplateOption[]; placeholder: string; actions: ReleaseTemplateActions; /** Marca la primera como «Por defecto» (solo las del usuario: las del proyecto no se eligen solas). */ showDefault?: boolean }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "" });
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const [owner] = useState(() => ({}));
  const rootRef = useRef<HTMLDivElement>(null);
  // Lo que había al abrir: si cambia, abrir otra edición pregunta antes de descartarlo.
  const original = useRef({ name: "", content: "" });
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  // Se registra como la edición abierta de la página (y se quita del registro al cerrarse o desmontarse).
  useEffect(() => {
    if (editing === null) return;
    const entry = {
      owner,
      dirty: () => formRef.current.name.trim() !== original.current.name.trim() || formRef.current.content.trim() !== original.current.content.trim(),
      name: () => formRef.current.name.trim() || original.current.name,
      close: () => setEditing(null),
    };
    activeEditor = entry;
    return () => {
      if (activeEditor === entry) activeEditor = null;
    };
  }, [editing, owner]);

  // Tras guardar o cancelar, el foco vuelve al lápiz de la fila (o a «Añadir…» si se canceló una nueva).
  const focusAfterClose = (id: string) =>
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(id === "new" ? "[data-tpl-add]" : `[data-tpl-edit="${CSS.escape(id)}"]`)?.focus());

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

  const open = async (tpl?: TemplateOption) => {
    const current = activeEditor;
    if (current?.dirty()) {
      const ok = await confirm({
        title: t("Cambios sin guardar"),
        message: t("«{name}» tiene cambios sin guardar. ¿Descartarlos?", { name: current.name() || t("Plantilla nueva") }),
        confirmLabel: t("Descartar cambios"),
        cancelLabel: t("Seguir editando"),
        danger: true,
      });
      if (!ok) return;
    }
    if (current && current.owner !== owner) current.close();
    const initialForm = tpl ? { name: tpl.name, content: tpl.content } : { name: "", content: "" };
    original.current = initialForm;
    formRef.current = initialForm;
    setEditing(tpl ? tpl.id : "new");
    setForm(initialForm);
    setPreview(false);
  };

  const cancel = () => {
    const id = editing;
    setEditing(null);
    if (id) focusAfterClose(id);
  };

  const save = () =>
    start(async () => {
      const id = editing;
      if (id === "new") {
        const res = await actions.create(kind, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => [...l, res.data]);
        setEditing(null);
        focusAfterClose(res.data.id);
      } else if (id) {
        const res = await actions.update(id, form);
        if (!res.ok) return toast(res.error, "error");
        setItems((l) => l.map((x) => (x.id === id ? { ...x, name: form.name.trim(), content: form.content } : x)));
        setEditing(null);
        focusAfterClose(id);
      }
      toast(t("Plantilla guardada"));
    });

  // La caja de edición ocupa el sitio de la plantilla (o el final de la lista si es nueva).
  const editor = (label: string) => (
    <li
      role="group"
      aria-label={label}
      className="space-y-2 bg-brand-50/50 p-3 ring-2 ring-brand-500/40 ring-inset dark:bg-brand-500/5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <input className="input" placeholder={t("Nombre (p. ej. «Para el equipo de negocio»)")} aria-label={t("Nombre")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} autoFocus />
      {/* La vista previa solo hace falta al escribir Markdown: el editor con barra ya muestra el resultado. */}
      {editorMode === "MARKDOWN" && (
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
        {[false, true].map((p) => (
          <button
            key={String(p)}
            type="button"
            onClick={() => setPreview(p)}
            aria-pressed={preview === p}
            className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium", preview === p ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
          >
            {p ? <><Eye size={13} /> {t("Vista previa")}</> : <><Pencil size={13} /> {t("Editar")}</>}
          </button>
        ))}
      </div>
      )}
      {preview && editorMode === "MARKDOWN" ? (
        <div className="min-h-24 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><Markdown>{form.content}</Markdown></div>
      ) : (
        <DescriptionField mode={editorMode} textareaClassName="input field-sizing-content min-h-28 font-mono text-[13px]" value={form.content} onValueChange={(content) => setForm((f) => ({ ...f, content: content.slice(0, 20000) }))} users={NO_USERS} placeholder={placeholder} />
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary py-1.5" onClick={save} disabled={pending || !form.name.trim()}><Check size={15} /> {t("Guardar")}</button>
        <button type="button" className="btn-ghost py-1.5" onClick={cancel}><X size={15} /> {t("Cancelar")}</button>
      </div>
    </li>
  );

  return (
    <div className="mt-5" ref={rootRef}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((tpl, i) =>
          editing === tpl.id ? (
            <Fragment key={tpl.id}>{editor(t("Editar {name}", { name: tpl.name }))}</Fragment>
          ) : (
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
              <button className="btn-icon h-7 w-7" data-tpl-edit={tpl.id} onClick={() => void open(tpl)} aria-label={t("Editar {name}", { name: tpl.name })}><Pencil size={14} /></button>
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
          ),
        )}
        {editing === "new" && editor(kind === "HEADER" ? t("Nueva cabecera") : t("Nuevo pie"))}
        {items.length === 0 && editing !== "new" && <li className="px-3 py-2 text-sm text-slate-500">{t("Ninguna todavía.")}</li>}
      </ul>
      {editing !== "new" && (
        <button type="button" className="btn-ghost mt-1 py-1 text-xs" data-tpl-add onClick={() => void open()}>
          <Plus size={14} /> {kind === "HEADER" ? t("Añadir cabecera") : t("Añadir pie")}
        </button>
      )}
    </div>
  );
}
