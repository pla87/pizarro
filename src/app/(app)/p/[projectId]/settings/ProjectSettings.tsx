"use client";

import { CalendarClock, Check, EyeOff, Loader2, Pencil, Plus, Trash2, Users as UsersIcon, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createDeliverable, createLabel, deleteDeliverable, deleteLabel, addProjectMember, deleteProject, removeProjectMember, setProjectVisibility, setAttachmentLimits, setGoogleShareMode, updateDeliverable, updateLabel, updateProject,
} from "@/actions/projects";
import { formatDay } from "@/lib/dates";
import { useIntlLocale, useT } from "@/i18n/client";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { TypeBadge } from "@/components/ui/TypeBadge";
import { isWhite, onColor, PALETTE, RELEASE_ZIP_MAX_MB, RELEASE_ZIP_MIN_MB } from "@/lib/constants";
import { GOOGLE_SHARE_MODES, isDomainMode, type GoogleShareMode } from "@/lib/google-share";
import type { EditorModeValue, KindOption, LabelOption } from "@/lib/types";
import { KindsManager, type KindRow } from "@/components/kinds/KindsManager";
import { setGeneralKindEnabled } from "@/actions/project-kinds";

interface Props {
  isAdmin: boolean;
  currentUserId: string;
  project: { id: string; name: string; description: string; visibility: "TEAM" | "PRIVATE"; releaseZipMaxMb: number; taskAttachMaxMb: number; googleShareMode: GoogleShareMode; members: { id: string; name: string; active: boolean }[] };
  labels: LabelOption[];
  kinds: KindRow[];
  /** Todos los tipos generales, con si el proyecto los usa y cuántas tareas tienen aquí. */
  generalKinds: (KindOption & { enabled: boolean; taskCount: number })[];
  deliverables: DeliverableRow[];
  users: { id: string; name: string; role: "ADMIN" | "MEMBER" }[];
  editorMode: EditorModeValue;
  /** Integración con Google: si está activa y el dominio de Workspace configurado (para ofrecer compartir con él). */
  google: { enabled: boolean; domain: string | null };
  /** Sección «Informe semanal por email» (la monta la página). */
  reportSchedule?: React.ReactNode;
}

const SHARE_MODE_LABEL: Record<GoogleShareMode, string> = {
  DOMAIN_WRITE: "Todo el dominio puede editar",
  DOMAIN_READ: "Todo el dominio puede leer",
  MEMBERS: "Solo las personas del proyecto (editores)",
  NONE: "No compartir (solo quien lo crea)",
};

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

export function ProjectSettings({ isAdmin, currentUserId, project, deliverables, kinds, generalKinds, labels: initialLabels, users, editorMode, google, reportSchedule }: Props) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [zipMb, setZipMb] = useState(String(project.releaseZipMaxMb));
  const [taskMb, setTaskMb] = useState(String(project.taskAttachMaxMb));
  const [shareMode, setShareMode] = useState<GoogleShareMode>(project.googleShareMode);
  const [visibility, setVisibility] = useState(project.visibility);
  const [labels, setLabels] = useState(initialLabels);
  const [confirmName, setConfirmName] = useState("");
  // Los miembros de un proyecto privado lo gestionan aunque no sean administradores.
  const isPrivateProject = project.visibility === "PRIVATE";
  const canManage = isAdmin || isPrivateProject;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error, "error");
      toast(success);
      after?.();
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("Ajustes del proyecto")}</h1>
        <Link href={`/p/${project.id}`} className="btn-primary">{t("Ir al tablero")}</Link>
      </div>

      {canManage && (
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

      {canManage && (
        <Section title="Releases" description="Límites al generar o descargar una release.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (Number(zipMb) < Number(taskMb)) {
                toast(t("El paquete ZIP de una release no puede ser menor que el máximo de adjuntos de una tarea."), "error");
                return;
              }
              run(async () => setAttachmentLimits(project.id, Number(taskMb), Number(zipMb)), t("Proyecto actualizado"), () => router.refresh());
            }}
          >
            <div>
              <label className="label" htmlFor="p-task-mb">{t("Tamaño máximo de los adjuntos de una tarea (MB)")}</label>
              <input
                id="p-task-mb" className="input w-32" type="number" inputMode="numeric" step={1}
                min={RELEASE_ZIP_MIN_MB} max={RELEASE_ZIP_MAX_MB} value={taskMb} onChange={(e) => setTaskMb(e.target.value)} required
              />
              <p className="mt-1 text-xs text-slate-500">{t("Entre {min} y {max} MB (por defecto 80). Es lo máximo que pueden sumar todos los adjuntos de una tarea.", { min: RELEASE_ZIP_MIN_MB, max: RELEASE_ZIP_MAX_MB })}</p>
            </div>
            <div>
              <label className="label" htmlFor="p-zip-mb">{t("Tamaño máximo de cada paquete ZIP de una release (MB)")}</label>
              <input
                id="p-zip-mb" className="input w-32" type="number" inputMode="numeric" step={1}
                min={RELEASE_ZIP_MIN_MB} max={RELEASE_ZIP_MAX_MB} value={zipMb} onChange={(e) => setZipMb(e.target.value)} required
              />
              <p className="mt-1 text-xs text-slate-500">{t("Entre {min} y {max} MB (por defecto 80), y nunca menos que el máximo de adjuntos de una tarea. Si los adjuntos de una release superan este tamaño, se descargan en varios ZIP de hasta ese tamaño; cada ZIP se arma en memoria del servidor: súbelo solo si hace falta.", { min: RELEASE_ZIP_MIN_MB, max: RELEASE_ZIP_MAX_MB })}</p>
            </div>
            <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
          </form>
        </Section>
      )}

      {canManage && google.enabled && (
        <Section title="Documentos de Google" description="Con quién se comparten los Docs y Sheets que se crean desde las tareas de este proyecto.">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => setGoogleShareMode(project.id, shareMode), t("Proyecto actualizado"), () => router.refresh());
            }}
          >
            {GOOGLE_SHARE_MODES.map((m) => {
              // Los modos de dominio solo existen en proyectos de equipo y con un dominio de Workspace configurado.
              const unavailable = isDomainMode(m) && (isPrivateProject || !google.domain);
              return (
                <label key={m} className={cn("flex items-start gap-2 text-sm", unavailable && "opacity-50")}>
                  <input type="radio" name="google-share" className="mt-1" checked={shareMode === m} disabled={unavailable} onChange={() => setShareMode(m)} />
                  <span>{t(SHARE_MODE_LABEL[m])}</span>
                </label>
              );
            })}
            {!google.domain && <p className="text-xs text-slate-500">{t("Las opciones de dominio no están disponibles: el servidor no tiene configurado GOOGLE_WORKSPACE_DOMAIN.")}</p>}
            {isPrivateProject && <p className="text-xs text-slate-500">{t("Un proyecto privado nunca se comparte con todo el dominio.")}</p>}
            <p className="text-xs text-slate-500">{t("Si el documento no se puede compartir, se crea igualmente y se avisa en la tarea de que solo lo ve quien lo crea.")}</p>
            <button className="btn-primary" disabled={pending}>{t("Guardar")}</button>
          </form>
        </Section>
      )}

      {!isAdmin && isPrivateProject && (
        <Section title="Visibilidad" description="Proyecto privado: solo lo ven sus miembros, tampoco los administradores. Cualquier miembro puede añadir o quitar miembros.">
          <MemberManager projectId={project.id} currentUserId={currentUserId} members={project.members} users={users} isPrivate />
        </Section>
      )}

      {isAdmin && (
        <Section title="Visibilidad" description="Equipo: lo ven los usuarios asignados y todos los administradores. Privado: solo sus miembros.">
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={visibility === "TEAM"} onChange={() => setVisibility("TEAM")} />
              <UsersIcon size={15} className="mt-0.5 shrink-0" />
              <span>
                {t("Equipo")}
                <span className="block text-xs text-slate-500">{t("Los usuarios asignados y todos los administradores.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={visibility === "PRIVATE"} onChange={() => setVisibility("PRIVATE")} />
              <EyeOff size={15} className="mt-0.5 shrink-0" />
              <span>
                {t("Privado: solo sus miembros")}
                <span className="block text-xs text-slate-500">{t("Solo los miembros lo ven y pueden entrar, tampoco los administradores. Tú serás el primer miembro.")}</span>
              </span>
            </label>
          </div>
          {visibility === project.visibility && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-slate-500">{isPrivateProject ? t("Miembros") : t("Usuarios asignados")}</div>
              <MemberManager projectId={project.id} currentUserId={currentUserId} members={project.members} users={isPrivateProject ? users : users.filter((u) => u.role !== "ADMIN")} isPrivate={isPrivateProject} />
              {!isPrivateProject && <p className="mt-2 text-xs text-slate-500">{t("Los administradores ven todos los proyectos de equipo; eligen en su perfil en cuáles trabajan.")}</p>}
            </div>
          )}
          {visibility !== project.visibility && (
            <button
              className="btn-primary mt-4"
              disabled={pending}
              onClick={async () => {
                if (visibility === "PRIVATE" && !(await confirm({ title: t("Hacer el proyecto privado"), message: t("¿Hacer el proyecto privado? Solo lo verás tú (podrás añadir más miembros después): los demás dejarán de verlo, incluidos los administradores, y se desasignarán sus tarjetas."), confirmLabel: t("Hacer privado"), danger: true }))) return;
                run(() => setProjectVisibility(project.id, visibility), t("Visibilidad actualizada"), () => router.refresh());
              }}
            >
              {t("Guardar visibilidad")}
            </button>
          )}
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

      {reportSchedule}

      <Section title="Tarjetas archivadas">
        <p className="text-sm text-slate-500">{t("Las tarjetas archivadas se consultan y recuperan desde el botón «Archivadas» del tablero.")}</p>
      </Section>

      {canManage && (
        <Section title="Borrar proyecto" description="Borra el proyecto con todas sus columnas, tarjetas, adjuntos y releases. No se puede deshacer.">
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              placeholder={t("Escribe «{name}» para confirmar", { name: project.name })}
              aria-label={t("Escribe «{name}» para confirmar", { name: project.name })}
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

/** Usuarios del proyecto. Privado: cualquier miembro añade, quita o sale (el último no puede salir). Equipo: lo gestionan los administradores. */
function MemberManager({ projectId, currentUserId, members, users, isPrivate }: {
  projectId: string;
  currentUserId: string;
  members: { id: string; name: string; active: boolean }[];
  users: { id: string; name: string }[];
  isPrivate: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [candidate, setCandidate] = useState("");
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error, "error");
      toast(success);
      after?.();
      router.refresh();
    });
  const activeCount = members.filter((m) => m.active).length;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {members.map((m) => {
          const isMe = isPrivate && m.id === currentUserId;
          // El último miembro activo no puede salir: debe borrar el proyecto.
          const lastOne = isMe && activeCount <= 1;
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {m.name}
                {isMe && <span className="ml-1 text-xs text-slate-500">{t("(tú)")}</span>}
                {!m.active && <span className="ml-1 text-xs text-slate-500">{t("(desactivado)")}</span>}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={pending || lastOne}
                title={lastOne ? t("Eres el último miembro: si ya no lo necesitas, borra el proyecto.") : undefined}
                onClick={async () => {
                  if (isMe && !(await confirm({ title: t("Salir del proyecto"), message: t("¿Salir del proyecto? Dejarás de verlo salvo que otro miembro te vuelva a añadir."), confirmLabel: t("Salir"), danger: true }))) return;
                  run(
                    () => removeProjectMember(projectId, m.id),
                    isMe ? t("Has salido del proyecto") : t("Miembro quitado"),
                    isMe ? () => router.push("/") : undefined,
                  );
                }}
              >
                {isMe ? t("Salir del proyecto") : t("Quitar")}
              </button>
            </li>
          );
        })}
      </ul>
      {members.length === 0 && <p className="text-sm text-slate-500">{t("Nadie asignado.")}</p>}
      <div className="flex gap-2">
        <select className="input min-w-0 max-w-xs flex-1" aria-label={t("Añadir miembro")} value={candidate} onChange={(e) => setCandidate(e.target.value)}>
          <option value="">{t("Añadir miembro…")}</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={pending || !candidate}
          onClick={() => run(() => addProjectMember(projectId, candidate), t("Miembro añadido"), () => setCandidate(""))}
        >
          {t("Añadir")}
        </button>
      </div>
    </div>
  );
}

function LabelRow({ label, onSaved, onDeleted }: { label: LabelOption; onSaved: (l: LabelOption) => void; onDeleted: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
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
            if (!(await confirm({ title: t("Borrar etiqueta"), message: t("¿Borrar la etiqueta «{name}»? Se quitará de todas las tarjetas.", { name: label.name }), confirmLabel: t("Borrar"), danger: true }))) return;
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
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={t("Nombre")} />
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
  const confirm = useConfirm();
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
                if (!(await confirm({ title: t("Borrar entregable"), message: t("¿Borrar el entregable «{name}»? Sus tarjetas se conservan, sin entregable.", { name: d.name }), confirmLabel: t("Borrar"), danger: true }))) return;
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
