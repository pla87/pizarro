"use client";

import { CalendarClock, Check, EyeOff, Loader2, Lock, Pencil, Plus, Trash2, Users as UsersIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createDeliverable, createLabel, deleteDeliverable, deleteLabel, deleteProject, setProjectVisibility, updateDeliverable, updateLabel, updateProject,
} from "@/actions/projects";
import { formatDay } from "@/lib/dates";
import { useIntlLocale, useT } from "@/i18n/client";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { isWhite, onColor, PALETTE } from "@/lib/constants";
import type { EditorModeValue, KindOption, LabelOption } from "@/lib/types";
import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";
import { setGeneralKindEnabled } from "@/actions/project-kinds";

interface Props {
  isAdmin: boolean;
  project: { id: string; name: string; description: string; visibility: "PUBLIC" | "RESTRICTED" | "PRIVATE"; memberIds: string[] };
  labels: LabelOption[];
  kinds: KindRow[];
  /** Todos los tipos generales, con si el proyecto los usa y cuántas tareas tienen aquí. */
  generalKinds: (KindOption & { enabled: boolean; taskCount: number })[];
  deliverables: DeliverableRow[];
  users: { id: string; name: string; role: "ADMIN" | "MEMBER" }[];
  editorMode: EditorModeValue;
}

function Section({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  const t = useT();
  return (
    <section id={id} className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{t(title)}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{t(description)}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProjectSettings({ isAdmin, project, deliverables, kinds, generalKinds, labels: initialLabels, users, editorMode }: Props) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [visibility, setVisibility] = useState(project.visibility);
  const [members, setMembers] = useState(new Set(project.memberIds));
  const [labels, setLabels] = useState(initialLabels);
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
      <h1 className="text-xl font-semibold">{t("Ajustes del proyecto")}</h1>

      {isAdmin && (
        <Section title="General">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => updateProject(project.id, { name, description }), t("Proyecto actualizado"), () => router.refresh());
            }}
          >
            <div>
              <label className="label" htmlFor="p-name">{t("Nombre")}</label>
              <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div>
              <label className="label" htmlFor="p-desc">{t("Descripción")}</label>
              <textarea id="p-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
            <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
          </form>
        </Section>
      )}

      {isAdmin && (
        <Section title="Visibilidad" description="Por defecto todos los usuarios ven el proyecto. Puedes limitarlo a usuarios concretos o hacerlo privado.">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "PUBLIC"} onChange={() => setVisibility("PUBLIC")} />
              <UsersIcon size={15} /> {t("Visible para todos los usuarios")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "RESTRICTED"} onChange={() => setVisibility("RESTRICTED")} />
              <Lock size={15} /> {t("Solo los usuarios seleccionados (y los administradores)")}
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={visibility === "PRIVATE"} onChange={() => setVisibility("PRIVATE")} />
              <EyeOff size={15} className="mt-0.5 shrink-0" />
              <span>
                {t("Privado: solo tú")}
                <span className="block text-xs text-slate-500">{t("Nadie más lo ve ni puede entrar, tampoco el resto de administradores.")}</span>
              </span>
            </label>
          </div>
          {visibility === "RESTRICTED" && (
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
                    {u.role === "ADMIN" && <span className="text-xs text-slate-500">{t("(administrador, siempre tiene acceso)")}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn-primary mt-4"
            disabled={pending}
            onClick={() => {
              if (visibility === "PRIVATE" && project.visibility !== "PRIVATE" && !window.confirm(t("¿Hacer el proyecto privado? Dejará de verlo todo el mundo menos tú, incluidos los demás administradores."))) return;
              run(() => setProjectVisibility(project.id, visibility, [...members]), t("Visibilidad actualizada"), () => router.refresh());
            }}
          >
            {t("Guardar visibilidad")}
          </button>
        </Section>
      )}

      <Section
        id="deliverables"
        title="Entregables"
        description="Hitos con fecha que agrupan tarjetas y salen en el informe PDF."
      >
        <Deliverables projectId={project.id} initial={deliverables} />
      </Section>

      <Section
        id="kinds"
        title="Tipos de tarea"
        description="Elige qué tipos generales usa este proyecto y crea tipos propios. En los selectores y en las releases van primero los generales y después los propios."
      >
        <GeneralKinds projectId={project.id} generalKinds={generalKinds} projectKinds={kinds} />
        <div className="mt-4 mb-2 text-xs font-medium text-slate-500">{t("Tipos propios del proyecto")}</div>
        <KindsManager kinds={kinds} projectId={project.id} otherKinds={generalKinds.filter((k) => k.enabled)} embedded editorMode={editorMode} />
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
          {labels.length === 0 && <li className="text-sm text-slate-500">{t("No hay etiquetas.")}</li>}
        </ul>
        <NewLabel projectId={project.id} onCreated={(l) => setLabels((ls) => [...ls, l].sort((a, b) => a.name.localeCompare(b.name)))} />
      </Section>

      <Section title="Columnas" description="Las columnas se crean, renombran, reordenan, cambian de rol y borran (si están vacías) desde el menú «⋯» de cada columna en el tablero." >
        <p className="text-sm text-slate-500">
          {t("El rol")} <strong>{t("Siguiente salto")}</strong> {t("muestra el botón «Generar Release»; el rol")} <strong>{t("En producción")}</strong> {t("es el destino de las tarjetas al marcar una release como desplegada.")}
        </p>
      </Section>

      <Section title="Tarjetas archivadas">
        <p className="text-sm text-slate-500">{t("Las tarjetas archivadas se consultan y recuperan desde el botón «Archivadas» del tablero.")}</p>
      </Section>

      {isAdmin && (
        <Section title="Borrar proyecto" description="Borra el proyecto con todas sus columnas, tarjetas, adjuntos y releases. No se puede deshacer.">
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              placeholder={t("Escribe «{name}» para confirmar", { name: project.name })}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <button
              className="btn-danger"
              disabled={pending || confirmName !== project.name}
              onClick={() => run(() => deleteProject(project.id, confirmName), t("Proyecto borrado"), () => { router.push("/"); router.refresh(); })}
            >
              <Trash2 size={15} /> {t("Borrar proyecto")}
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function LabelRow({ label, onSaved, onDeleted }: { label: LabelOption; onSaved: (l: LabelOption) => void; onDeleted: () => void }) {
  const t = useT();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string | null>(label.color);

  if (!editing) {
    return (
      <li className="flex items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: label.color, color: onColor(label.color), boxShadow: isWhite(label.color) ? "inset 0 0 0 1px rgb(0 0 0 / 0.2)" : undefined }}>{label.name}</span>
        <button className="btn-icon ml-auto h-7 w-7" onClick={() => setEditing(true)} aria-label={t("Editar etiqueta")}><Pencil size={14} /></button>
        <button
          className="btn-icon h-7 w-7 hover:text-red-600"
          aria-label={t("Borrar etiqueta")}
          onClick={async () => {
            if (!window.confirm(t("¿Borrar la etiqueta «{name}»? Se quitará de todas las tarjetas.", { name: label.name }))) return;
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
          <Check size={15} /> {t("Guardar")}
        </button>
        <button className="btn-ghost py-1.5" onClick={() => setEditing(false)}><X size={15} /> {t("Cancelar")}</button>
      </div>
    </li>
  );
}

function NewLabel({ projectId, onCreated }: { projectId: string; onCreated: (l: LabelOption) => void }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(PALETTE[9]);
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
        <input className="input" placeholder={t("Nueva etiqueta")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn-secondary shrink-0" disabled={!name.trim()}><Plus size={15} /> {t("Añadir")}</button>
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
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  // null: modal cerrado; "": nuevo entregable; id: edición.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", dueDate: "" });
  const [pending, start] = useTransition();

  const open = (d?: DeliverableRow) => {
    setEditing(d?.id ?? "");
    setForm(d ? { name: d.name, description: d.description, dueDate: d.dueDate ?? "" } : { name: "", description: "", dueDate: "" });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name: form.name, description: form.description, dueDate: form.dueDate || null };
    start(async () => {
      if (editing) {
        const res = await updateDeliverable(editing, input);
        if (!res.ok) return toast(res.error, "error");
        setRows((r) => r.map((d) => (d.id === editing ? { ...d, ...input, name: input.name.trim() } : d)));
        toast(t("Entregable actualizado"));
      } else {
        const res = await createDeliverable(projectId, input);
        if (!res.ok) return toast(res.error, "error");
        setRows((r) => [...r, { ...res.data, taskCount: 0 }]);
        toast(t("Entregable creado"));
      }
      setEditing(null);
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
                <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {d.dueDate ? formatDay(d.dueDate, undefined, locale) : t("Sin fecha")}</span>
                <span>{t("{n} tarjeta(s)", { n: d.taskCount })}</span>
              </div>
              {d.description && <p className="mt-0.5 text-xs text-slate-500">{d.description}</p>}
            </div>
            <button className="btn-icon h-7 w-7" aria-label={t("Editar entregable")} onClick={() => open(d)}>
              <Pencil size={14} />
            </button>
            <button
              className="btn-icon h-7 w-7 hover:text-red-600"
              aria-label={t("Borrar entregable")}
              onClick={async () => {
                if (!window.confirm(t("¿Borrar el entregable «{name}»? Sus tarjetas se conservan, sin entregable.", { name: d.name }))) return;
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
        {rows.length === 0 && <li className="py-2 text-sm text-slate-500">{t("No hay entregables.")}</li>}
      </ul>
      <button className="btn-primary mt-3" onClick={() => open()}>
        <Plus size={15} /> {t("Añadir entregable")}
      </button>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t("Editar entregable") : t("Nuevo entregable")}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>{t("Cancelar")}</button>
            <button type="submit" form="deliverable-form" className="btn-primary" disabled={pending || !form.name.trim()}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {editing ? t("Guardar") : t("Añadir")}
            </button>
          </>
        }
      >
        <form id="deliverable-form" onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="dl-name">{t("Nombre")}</label>
            <input id="dl-name" className="input" placeholder={t("p. ej. «Beta cerrada»")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required data-autofocus />
          </div>
          <div>
            <label className="label" htmlFor="dl-date">{t("Fecha objetivo (opcional)")}</label>
            <input id="dl-date" className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="dl-desc">{t("Descripción (opcional)")}</label>
            <textarea id="dl-desc" className="input field-sizing-content min-h-16" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** Tipos generales que usa el proyecto: los desmarcados no aparecen en él. */
function GeneralKinds({ projectId, generalKinds, projectKinds }: {
  projectId: string;
  generalKinds: (KindOption & { enabled: boolean; taskCount: number })[];
  projectKinds: KindRow[];
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [disabling, setDisabling] = useState<(KindOption & { taskCount: number }) | null>(null);
  const [replacement, setReplacement] = useState("");

  const apply = (kindId: string, enabled: boolean, replacementId: string | null) =>
    start(async () => {
      const res = await setGeneralKindEnabled(projectId, kindId, enabled, replacementId);
      if (!res.ok) return toast(res.error, "error");
      toast(enabled ? t("Tipo activado en el proyecto") : t("Tipo desactivado en el proyecto"));
      setDisabling(null);
      router.refresh();
    });

  const targets = (kindId: string) => [
    ...generalKinds.filter((k) => k.enabled && k.id !== kindId),
    ...projectKinds,
  ];

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">{t("Tipos generales que usa este proyecto")}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {generalKinds.map((k) => (
          <label key={k.id} className={cn("flex items-center gap-1.5 text-sm", pending && "opacity-60")}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={k.enabled}
              disabled={pending}
              onChange={() => {
                if (k.enabled && k.taskCount > 0) {
                  setDisabling(k);
                  setReplacement(targets(k.id)[0]?.id ?? "");
                } else apply(k.id, !k.enabled, null);
              }}
            />
            <TypeBadge kind={k} />
            {k.taskCount > 0 && <span className="text-xs text-slate-500">{k.taskCount}</span>}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("Los desmarcados no aparecen en los selectores ni en las releases de este proyecto.")}</p>
      {disabling && (
        <Modal open onClose={() => setDisabling(null)} title={t("Dejar de usar «{name}»", { name: disabling.name })} size="sm">
          <div className="space-y-3">
            <p className="text-sm">
              {disabling.taskCount === 1 ? t("Su tarea en este proyecto pasará al tipo:") : t("Sus {n} tareas en este proyecto pasarán al tipo:", { n: disabling.taskCount })}
            </p>
            <select className="input" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label={t("Tipo de destino")}>
              {targets(disabling.id).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDisabling(null)}>{t("Cancelar")}</button>
              <button className="btn-primary" disabled={pending || !replacement} onClick={() => apply(disabling.id, false, replacement)}>
                {t("Dejar de usarlo")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
