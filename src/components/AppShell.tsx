"use client";

import { BrandMark } from "@/components/ui/BrandMark";
import {
  Archive, Bell, ChevronsUpDown, FolderKanban, History, LayoutDashboard, ListChecks, LogOut, Menu, Plus, Rocket,
  Settings, Shield, SlidersHorizontal, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logout } from "@/actions/auth";
import { useT } from "@/i18n/client";
import { createProject } from "@/actions/projects";
import { listTemplates } from "@/actions/templates";
import type { CurrentUser } from "@/lib/session";
import { InstallApp } from "./InstallApp";
import { Presence } from "./board/Presence";
import { PrivateIcon, ProjectMenu, ProjectsContext } from "./ProjectMenu";
import { UndoButton } from "./UndoButton";
import { Avatar } from "./ui/Avatar";
import { ReportButton } from "./ReportButton";
import { cn } from "./ui/cn";
import { Modal } from "./ui/Modal";
import { ToastProvider, useToast } from "./ui/Toast";
import { useEscapeClose } from "./ui/useEscapeClose";

interface Props {
  user: CurrentUser;
  projects: { id: string; name: string; isPrivate?: boolean }[];
  version: string;
  unread: number;
  children: React.ReactNode;
}

export function AppShell(props: Props) {
  return (
    <ToastProvider>
      <Shell {...props} />
    </ToastProvider>
  );
}

function Shell({ user, projects, version, unread, children }: Props) {
  const t = useT();
  const pathname = usePathname();
  // El menú móvil se cierra solo al navegar: queda asociado a la ruta en que se abrió.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? pathname : null);
  useEscapeClose(drawerOpen, () => setDrawerPath(null));
  const projectId = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
  const current = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    // Recuerda el último proyecto para abrirlo directamente en la próxima visita.
    if (projectId) document.cookie = `tablon_last_project=${projectId}; path=/; max-age=31536000; samesite=lax`;
  }, [projectId]);

  const sidebar = (
    <Sidebar user={user} projects={projects} current={current} version={version} pathname={pathname} unread={unread} />
  );

  return (
    <ProjectsContext.Provider value={{ projects, currentId: current?.id ?? null }}>
    {/* Fijo al viewport: nunca hay scroll del documento. En Android con la barra de gestos dibujada
        encima (viewport-fit=cover) el contenido acaba justo antes de esa barra. */}
    <div className="fixed inset-0 flex overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-slate-900">
            <button className="btn-icon absolute top-3 right-3" onClick={() => setDrawerOpen(false)} aria-label={t("Cerrar menú")}>
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[env(safe-area-inset-top)] lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <button className="btn-icon" onClick={() => setDrawerOpen(true)} aria-label={t("Abrir menú")}>
            <Menu size={20} />
          </button>
          {/* Deshacer, justo a continuación del nombre del tablero. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <ProjectMenu className="min-w-0" />
            {current && <UndoButton projectId={current.id} className="shrink-0" />}
          </div>
          {current && <Presence projectId={current.id} compact />}
          {unread > 0 && (
            <Link href="/notifications" className="ml-auto flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white" aria-label={t("{n} avisos sin leer", { n: unread })}>
              <Bell size={13} /> {unread}
            </Link>
          )}
        </header>
        <main className="min-h-0 flex-1 overflow-auto max-lg:pb-[env(safe-area-inset-bottom)]">{children}</main>
      </div>
    </div>
    </ProjectsContext.Provider>
  );
}

function NavLink({ href, icon: Icon, children, active }: { href: string; icon: typeof Menu; children: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        // El contorno de foco va por dentro: el menú hace scroll y recortaría uno exterior.
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
        active
          ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
      )}
    >
      <Icon size={17} />
      {children}
    </Link>
  );
}

function Sidebar({ user, projects, current, version, pathname, unread }: {
  unread: number;
  user: CurrentUser;
  projects: { id: string; name: string; isPrivate?: boolean }[];
  current: { id: string; name: string; isPrivate?: boolean } | null;
  version: string;
  pathname: string;
}) {
  const t = useT();
  const isAdmin = user.role === "ADMIN";
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <BrandMark size={26} />
        <span className="text-lg font-bold tracking-tight">Pizarro</span>
      </div>

      <div className="px-3">
        <ProjectSwitcher projects={projects} current={current} isAdmin={isAdmin} />
      </div>

      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3">
        {current && (
          <>
            <NavLink href={`/p/${current.id}`} icon={LayoutDashboard} active={pathname === `/p/${current.id}`}>{t("Tablero")}</NavLink>
            <NavLink href={`/p/${current.id}/releases`} icon={Rocket} active={pathname.startsWith(`/p/${current.id}/releases`)}>{t("Releases")}</NavLink>
            <ReportButton projectId={current.id} variant="sidebar" />
            <NavLink href={`/p/${current.id}/settings`} icon={SlidersHorizontal} active={pathname.startsWith(`/p/${current.id}/settings`)}>{t("Ajustes del proyecto")}</NavLink>
            <NavLink href={`/p/${current.id}?archivadas=1`} icon={Archive} active={false}>{t("Archivadas")}</NavLink>
            <div className="my-3 border-t border-slate-200 dark:border-slate-800" />
          </>
        )}
        <NavLink href="/notifications" icon={Bell} active={pathname === "/notifications"}>
          <span className="flex-1">{t("Avisos")}</span>
          {unread > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" aria-label={t("{n} sin leer", { n: unread })}>{unread > 99 ? "99+" : unread}</span>
          )}
        </NavLink>
        <NavLink href="/my-tasks" icon={ListChecks} active={pathname === "/my-tasks"}>{t("Mis tareas asignadas")}</NavLink>
        <NavLink href="/settings" icon={Settings} active={pathname === "/settings"}>{t("Mi perfil y plantillas")}</NavLink>
        {isAdmin && <NavLink href="/admin" icon={Shield} active={pathname.startsWith("/admin")}>{t("Administración")}</NavLink>}
        <NavLink href="/changelog" icon={History} active={pathname === "/changelog"}>{t("Historial de versiones")}</NavLink>
        <InstallApp />
      </nav>

      <div className="border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Avatar id={user.id} name={user.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <Link href="/changelog" className="text-xs text-slate-500 hover:underline">v{version}</Link>
          </div>
          <form action={logout}>
            <button type="submit" className="btn-icon" title={t("Cerrar sesión")} aria-label={t("Cerrar sesión")}>
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcher({ projects, current, isAdmin }: { projects: { id: string; name: string; isPrivate?: boolean }[]; current: { id: string; name: string; isPrivate?: boolean } | null; isAdmin: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEscapeClose(open, () => setOpen(false));
  const [creating, setCreating] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FolderKanban size={16} className="shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1 truncate font-medium">{current?.name ?? t("Selecciona proyecto")}</span>
        {current?.isPrivate && <PrivateIcon />}
        <ChevronsUpDown size={15} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" role="listbox">
            {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-slate-500">{t("No tienes proyectos.")}</div>}
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/p/${p.id}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "block truncate rounded-md px-2.5 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                  p.id === current?.id && "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
                )}
                role="option"
                aria-selected={p.id === current?.id}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate">{p.name}</span>
                  {p.isPrivate && <PrivateIcon />}
                </span>
              </Link>
            ))}
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-slate-200 px-2.5 py-2 text-sm text-brand-600 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <Plus size={15} /> {t("Nuevo proyecto")}
            </button>
          </div>
        </>
      )}
      {creating && <NewProjectModal isAdmin={isAdmin} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProjectModal({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [templateId, setTemplateId] = useState("");
  // Quien no es administrador solo puede crear proyectos privados.
  const [isPrivate, setIsPrivate] = useState(!isAdmin);
  // Las plantillas (solo administradores) se piden al abrir el modal.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listTemplates().then((res) => {
      if (!cancelled && res.ok) setTemplates(res.data);
    });
    return () => { cancelled = true; };
  }, [isAdmin]);
  // Se cierra al llegar al proyecto nuevo, no antes: cerrar retira su entrada del historial
  // y eso cancelaría la navegación en curso.
  useEffect(() => {
    if (target && pathname === target) onClose();
  }, [target, pathname, onClose]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createProject(name, { templateId: templateId || null, isPrivate });
      if (!res.ok) return toast(res.error, "error");
      setTarget(`/p/${res.data.id}`);
      router.push(`/p/${res.data.id}`);
    });
  };
  return (
    <Modal open onClose={onClose} title={t("Nuevo proyecto")} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="project-name">{t("Nombre")}</label>
          <input id="project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-autofocus />
          <p className="mt-1 text-xs text-slate-500">{t("Luego puedes cambiar las columnas, tipos y etiquetas.")}</p>
        </div>
        {isAdmin && (
        <div>
          <label className="label" htmlFor="project-template">{t("Plantilla")}</label>
          <select id="project-template" className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{t("Columnas por defecto")}</option>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
          {templates.find((t) => t.id === templateId)?.description && (
            <p className="mt-1 text-xs text-slate-500">{templates.find((t) => t.id === templateId)?.description}</p>
          )}
        </div>
        )}
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            {t("Proyecto privado (solo sus miembros; empiezas siendo el único)")}
          </label>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <PrivateIcon /> {t("Será un proyecto privado: solo lo verás tú hasta que añadas más miembros.")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button type="submit" className="btn-primary" disabled={pending || !!target || !name.trim()}>{t("Crear")}</button>
        </div>
      </form>
    </Modal>
  );
}
