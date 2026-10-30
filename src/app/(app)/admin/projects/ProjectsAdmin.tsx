"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addProjectMember, removeProjectMember, setAdminProjectPick } from "@/actions/projects";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

interface AdminUser {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
}

interface Row {
  id: string;
  name: string;
  /** Usuarios no administradores asignados al proyecto. */
  memberIds: string[];
  /** Administradores que lo tienen entre sus proyectos de trabajo. */
  pickedAdminIds: string[];
}

/** «Proyectos»: quién está asignado a cada proyecto de equipo. Los administradores los ven todos. */
export function ProjectsAdmin({ projects, users }: { projects: Row[]; users: AdminUser[] }) {
  const t = useT();
  const byId = new Map(users.map((u) => [u.id, u]));
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {t("Proyectos de equipo y las personas asignadas. Quien no es administrador solo ve los proyectos a los que está asignado; los administradores ven todos y eligen en cuáles trabajan (en su perfil, o aquí pulsando su nombre). Los proyectos privados no aparecen aquí.")}
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
  const [pending, start] = useTransition();
  const [candidate, setCandidate] = useState("");
  const assigned = new Set(project.memberIds);
  // Los administradores no se asignan: ven todos los proyectos de equipo.
  const candidates = users.filter((u) => u.role !== "ADMIN" && !assigned.has(u.id));
  const members = project.memberIds.map((id) => byId.get(id)).filter((u): u is AdminUser => !!u);
  const admins = users.filter((u) => u.role === "ADMIN");
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
        <span className="shrink-0 text-xs text-slate-500">{t("{n} asignado(s)", { n: members.length })}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {members.map((u) => (
          <li key={u.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-sm dark:bg-slate-800">
            <span className="truncate">{u.name}</span>
            <button
              type="button"
              className="btn-icon h-6 w-6 shrink-0 hover:text-red-600"
              disabled={pending}
              aria-label={t("Quitar a {name}", { name: u.name })}
              onClick={async () => {
                if (!(await confirm({ title: t("Quitar del proyecto"), message: t("¿Quitar a {name} de «{project}»? Dejará de verlo y sus tarjetas quedarán sin asignar.", { name: u.name, project: project.name }), confirmLabel: t("Quitar"), danger: true }))) return;
                run(() => removeProjectMember(project.id, u.id), t("Asignación quitada"));
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
                title={on ? t("Quitar «{project}» de los proyectos en los que trabaja {name}", { project: project.name, name: u.name }) : t("Añadir «{project}» a los proyectos en los que trabaja {name}", { project: project.name, name: u.name })}
                className={`inline-flex max-w-full items-center rounded-full border border-dashed px-2.5 py-0.5 text-sm hover:bg-slate-50 disabled:opacity-60 dark:hover:bg-slate-800 ${on ? "border-brand-500 text-slate-700 dark:text-slate-200" : "border-slate-300 text-slate-500 dark:border-slate-700"}`}
                onClick={() => run(() => setAdminProjectPick(project.id, u.id, !on), on ? t("Proyecto quitado de sus proyectos de trabajo") : t("Proyecto añadido a sus proyectos de trabajo"))}
              >
                <span className="truncate">{u.name}</span>
                <span className="ml-1 shrink-0 text-xs text-slate-500">{on ? t("(admin, ve todos; elegido)") : t("(admin, ve todos; no elegido)")}</span>
              </button>
            </li>
          );
        })}
        {members.length === 0 && admins.length === 0 && <li className="text-sm text-slate-500">{t("Nadie asignado.")}</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <select className="input min-w-0 flex-1" aria-label={t("Asignar usuario")} value={candidate} onChange={(e) => setCandidate(e.target.value)}>
          <option value="">{t("Asignar usuario…")}</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={pending || !candidate}
          onClick={() => run(() => addProjectMember(project.id, candidate), t("Usuario asignado"), () => setCandidate(""))}
        >
          {t("Asignar")}
        </button>
      </div>
    </li>
  );
}
