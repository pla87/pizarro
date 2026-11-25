"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addProjectMember, removeProjectMember, setAdminProjectPick } from "@/actions/projects";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";

interface AdminUser {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  /** Invitada que aún no ha elegido contraseña ni ha entrado. */
  invitePending: boolean;
}

interface Row {
  id: string;
  name: string;
  /** Miembros del proyecto (administradores incluidos). */
  memberIds: string[];
  /** Administradores que lo tienen entre sus proyectos de trabajo. */
  pickedAdminIds: string[];
}

/** «Proyectos»: los miembros de cada proyecto de equipo (como en Ajustes del proyecto). Los administradores los ven todos. */
export function ProjectsAdmin({ projects, users }: { projects: Row[]; users: AdminUser[] }) {
  const t = useT();
  const byId = new Map(users.map((u) => [u.id, u]));
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-sm text-slate-500">
        {t("Proyectos de equipo y sus miembros. Los privados no salen aquí.")}
        <InfoTip topic={t("Proyectos")}>{t("Quien no es administrador solo ve los proyectos de los que es miembro. Los administradores ven todos: se les puede añadir como miembros igual que a cualquiera y, si no lo son, eligen en cuáles trabajan pulsando su nombre (o en su perfil).")}</InfoTip>
      </p>
      {projects.length === 0 && <p className="card p-5 text-sm text-slate-500">{t("No hay proyectos de equipo.")}</p>}
      <ul className="space-y-3">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} users={users} byId={byId} />
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ project, users, byId }: { project: Row; users: AdminUser[]; byId: Map<string, AdminUser> }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useActionTransition();
  const [candidate, setCandidate] = useState("");
  const memberSet = new Set(project.memberIds);
  const candidates = users.filter((u) => !memberSet.has(u.id));
  const members = project.memberIds.map((id) => byId.get(id)).filter((u): u is AdminUser => !!u);
  // Los administradores que no son miembros ven el proyecto igualmente: su botón lo añade o quita de sus proyectos de trabajo.
  const admins = users.filter((u) => u.role === "ADMIN" && !memberSet.has(u.id));
  const pickedAdmins = new Set(project.pickedAdminIds);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return toast(res.error, "error");
      toast(success);
      after?.();
      router.refresh();
    });

  return (
    <li className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/p/${project.id}`} className="min-w-0 truncate font-semibold hover:underline">{project.name}</Link>
        {/* Los administradores que no son miembros salen debajo (con borde discontinuo): el recuento los nombra aparte para
            que «0 miembros» no contradiga lo que se ve. */}
        <span className="shrink-0 text-xs text-slate-500">
          {members.length === 1 ? t("1 miembro") : t("{n} miembros", { n: members.length })}
          {admins.length > 0 && <> · {admins.length === 1 ? t("1 admin sin ser miembro") : t("{n} admins sin ser miembros", { n: admins.length })}</>}
        </span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {members.map((u) => (
          <li key={u.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-sm dark:bg-slate-800">
            <span className="truncate">{u.name}</span>
            {u.role === "ADMIN" && <span className="shrink-0 text-xs text-slate-500">{t("admin")}</span>}
            {u.invitePending && <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400" title={t("Aún no ha entrado ni ha elegido su contraseña")}>{t("Invitación pendiente")}</span>}
            <button
              type="button"
              className="btn-icon h-6 w-6 shrink-0 hover:text-red-600"
              disabled={pending}
              aria-label={t("Quitar a {name}", { name: u.name })}
              onClick={async () => {
                const message = u.role === "ADMIN"
                  ? t("¿Quitar a {name} de los miembros de «{project}»? Como es administrador, lo sigue viendo y conserva sus tarjetas.", { name: u.name, project: project.name })
                  : t("¿Quitar a {name} de «{project}»? Dejará de verlo y sus tarjetas quedarán sin asignar.", { name: u.name, project: project.name });
                if (!(await confirm({ title: t("Quitar del proyecto"), message, confirmLabel: t("Quitar"), danger: true }))) return;
                run(() => removeProjectMember(project.id, u.id), t("Miembro quitado"));
              }}
            >
              <X size={13} />
            </button>
          </li>
        ))}
        {admins.map((u) => {
          const on = pickedAdmins.has(u.id);
          return (
            <li key={u.id} className="max-w-full">
              <button
                type="button"
                aria-pressed={on}
                disabled={pending}
                aria-describedby={`admin-pick-${project.id}-${u.id}`}
                className={`inline-flex max-w-full items-center rounded-full border border-dashed px-2.5 py-0.5 text-sm hover:bg-slate-50 disabled:opacity-60 dark:hover:bg-slate-800 ${on ? "border-brand-500 text-slate-700 dark:text-slate-200" : "border-slate-300 text-slate-500 dark:border-slate-700"}`}
                onClick={() => run(() => setAdminProjectPick(project.id, u.id, !on), on ? t("Proyecto quitado de sus proyectos de trabajo") : t("Proyecto añadido a sus proyectos de trabajo"))}
              >
                <span className="truncate">{u.name}</span>
                <span className="ml-1 shrink-0 text-xs text-slate-500">{on ? t("(admin, no miembro; lo tiene en su lista)") : t("(admin, no miembro; no lo tiene en su lista)")}</span>
              </button>
              {/* Qué hace, como descripción (con `title`, algunas herramientas nombraban el botón con ella). */}
              <span id={`admin-pick-${project.id}-${u.id}`} className="sr-only">
                {on ? t("Quitar «{project}» de los proyectos en los que trabaja {name}", { project: project.name, name: u.name }) : t("Añadir «{project}» a los proyectos en los que trabaja {name}", { project: project.name, name: u.name })}
              </span>
            </li>
          );
        })}
        {members.length === 0 && admins.length === 0 && <li className="text-sm text-slate-500">{t("Sin miembros.")}</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <select className="input min-w-0 flex-1" aria-label={t("Añadir miembro")} value={candidate} onChange={(e) => setCandidate(e.target.value)} disabled={candidates.length === 0}>
          <option value="">{candidates.length === 0 ? t("No queda nadie por añadir") : t("Añadir miembro…")}</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={pending || !candidate}
          onClick={() => run(() => addProjectMember(project.id, candidate), t("Miembro añadido"), () => setCandidate(""))}
        >
          {t("Añadir")}
        </button>
      </div>
    </li>
  );
}
