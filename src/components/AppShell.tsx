"use client";

import { BrandMark } from "@/components/ui/BrandMark";
import { useFocusRingScroll } from "@/components/ui/useFocusRingScroll";
import {
  Archive, Bell, CalendarDays, ChevronsUpDown, FileText, FolderKanban, LayoutDashboard, ListChecks, LogOut, Menu, Plus, Rocket,
  Settings, Shield, SlidersHorizontal, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { logout } from "@/actions/auth";
import { useT } from "@/i18n/client";
import { createProject, listProjectStarts } from "@/actions/projects";
import { projectOutsideList } from "@/actions/project-visit";
import type { CurrentUser } from "@/lib/session";
import type { FeedbackStatus } from "@/lib/feedback-core";
import { onUnreadCount } from "@/lib/unread-core";
import { AppBadge } from "./AppBadge";
import { InstallApp } from "./InstallApp";
import { LicenseNudge } from "./LicenseNudge";
import { FeedbackButton, FeedbackProvider } from "./feedback/Feedback";
import { clearDraftsOnLogout } from "./board/drafts";
import { OPEN_PROJECT_MENU_EVENT } from "./board/shortcuts";
import { filesFrom, hasFiles } from "./board/upload";
import { documentFailuresMessage, documentUploadName, uploadDocument } from "./docs/uploadDocuments";
import { installDragMove } from "./ui/dragMove";
import { Presence } from "./board/Presence";
import { OutsideListNotice, PrivateIcon, ProjectMenu, ProjectsContext, useProjectSwitchHref } from "./ProjectMenu";
import { UndoButton } from "./UndoButton";
import { Avatar } from "./ui/Avatar";
import { ReportButton } from "./ReportButton";
import { MAIN_ID, SkipToContent } from "./SkipToContent";
import { ImportProjectPanel } from "./ImportProjectPanel";
import { TransferJobWatcher } from "./transfer/TransferJobWatcher";
import { ConnectionNotice } from "./ConnectionNotice";
import { cn } from "./ui/cn";
import { HoverPrefetchLink } from "./ui/HoverPrefetchLink";
import { Menu as DropdownMenu, MenuItem } from "./ui/Menu";
import { Modal } from "./ui/Modal";
import { ConfirmProvider } from "./ui/ConfirmDialog";
import { PromptProvider } from "./ui/PromptDialog";
import { ToastProvider, useToast } from "./ui/Toast";
import { useEscapeClose } from "./ui/useEscapeClose";
import { useFocusTrap } from "./ui/focusTrap";
import { useSafeRefresh } from "@/components/useSafeRefresh";
import { loadWhenOnline } from "@/lib/connection";
import { useActionTransition } from "@/components/useActionTransition";
import { showProjectIntroOnce } from "@/components/board/ProjectIntroNotice";
import { useReleaseNav } from "@/components/board/releaseNav";

interface Props {
  user: CurrentUser;
  /** `outside`: abierto ahora pero fuera de «Proyectos en los que trabajo» (solo administradores, ver useOutsideListProject). */
  projects: { id: string; name: string; isPrivate?: boolean; outside?: boolean }[];
  version: string;
  unread: number;
  /** Último proyecto visitado (cookie ya validada contra los visibles): se mantiene seleccionado fuera de /p/…. */
  lastProjectId?: string | null;
  /** Administrador en un proyecto de equipo que no está en su lista (al cargar la página en /p/…): se muestra igualmente. */
  outsideProject?: { id: string; name: string } | null;
  /** El proyecto de la página cargada usa releases (columna «Siguiente salto» o alguna hecha); sin dato, se enseña «Releases». */
  releaseNav?: { id: string; show: boolean } | null;
  /** Copia de seguridad atrasada ("shrunk": mucho menor que la última buena): punto de aviso junto a «Administración» (solo admins). */
  backupAlert?: boolean | "shrunk";
  /** Versión nueva de Pizarro sin descartar: punto de aviso junto a «Administración» (solo admins). */
  updateAvailable?: boolean;
  /** Disco de las subidas casi lleno (por debajo de HEALTH_MIN_FREE_MB): punto de aviso junto a «Administración» (solo admins). */
  diskLow?: boolean;
  /** Recordatorio de licencia para este administrador: destino de «Comprar» (null: no se muestra). */
  licenseNudge?: string | null;
  /** «Informar de un error o enviar una sugerencia» (null: no es una build oficial sin modificar y no hay botón). */
  feedback?: FeedbackStatus | null;
  children: React.ReactNode;
}

export function AppShell(props: Props) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>
          <TransferJobWatcher />
          <ConnectionNotice />
          <Shell {...props} />
        </PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Shell({ user, projects: listed, version, unread: serverUnread, lastProjectId = null, outsideProject = null, releaseNav = null, backupAlert = false, updateAvailable = false, diskLow = false, licenseNudge = null, feedback = null, children }: Props) {
  useFocusRingScroll();
  const t = useT();
  const pathname = usePathname();
  // El menú móvil se cierra solo al navegar: queda asociado a la ruta en que se abrió.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawerOpen = drawerPath === pathname;
  const setDrawerOpen = (open: boolean) => setDrawerPath(open ? pathname : null);
  useEscapeClose(drawerOpen, () => setDrawerPath(null), { yieldToModal: true });
  const closeDrawer = useCallback(() => setDrawerPath(null), []);
  // «Nuevo proyecto» del selector: el diálogo se pinta aquí, fuera del menú móvil, para poder cerrar el menú al abrirlo
  // (dentro del menú, cerrarlo se llevaba el diálogo; abierto, quedaba detrás).
  const [creatingProject, setCreatingProject] = useState(false);
  const openNewProject = useCallback(() => {
    closeDrawer();
    setCreatingProject(true);
  }, [closeDrawer]);
  // Menú móvil como diálogo: el foco entra en «Cerrar menú», Tab no sale de él y al cerrar vuelve a «Abrir menú».
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerOpenerRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(drawerOpen, drawerRef, { initialRef: drawerCloseRef, returnRef: drawerOpenerRef });
  const projectId = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
  // En páginas que no son de un proyecto (calendario, avisos, perfil…) sigue seleccionado el último visitado,
  // para volver a su tablero sin elegirlo de nuevo.
  const [lastId, setLastId] = useState(lastProjectId);
  if (projectId && projectId !== lastId && listed.some((p) => p.id === projectId)) setLastId(projectId);
  const projects = useOutsideListProject(user, listed, projectId, outsideProject);
  const current = projects.find((p) => p.id === (projectId ?? lastId)) ?? null;
  // Deshacer y presencia son del proyecto que se está viendo, no del recordado.
  const inProject = Boolean(projectId && current?.id === projectId);

  // Avisos sin leer: los da el layout y, al leer uno en la lista de Avisos, el número que devuelve la acción
  // (`pz:unread`), tal cual, sin volver a pedir la página (al abrir un aviso, eso pedía otra vez el tablero entero).
  // Cada render del layout en el servidor (refresco, recarga) trae un `user` nuevo y con él el número del servidor,
  // aunque coincida con el anterior.
  const [unreadSeen, setUnreadSeen] = useState({ from: user, count: serverUnread });
  if (unreadSeen.from !== user) setUnreadSeen({ from: user, count: serverUnread });
  const unread = unreadSeen.from === user ? unreadSeen.count : serverUnread;
  useEffect(() => onUnreadCount((count) => setUnreadSeen((s) => ({ ...s, count }))), []);

  // Mover/copiar texto arrastrado entre campos (incluido el editor TipTap).
  useEffect(() => installDragMove(), []);

  useEffect(() => {
    // Recuerda el último proyecto para abrirlo directamente en la próxima visita.
    if (projectId) document.cookie = `tablon_last_project=${projectId}; path=/; max-age=31536000; samesite=lax`;
  }, [projectId]);

  // El recordatorio de licencia se queda una vez mostrado: al verlo se pospone 30 días y el layout deja de pedirlo,
  // pero no debe desaparecer al navegar o refrescar (solo lo cierra quien lo ve).
  const [nudgeHref, setNudgeHref] = useState(licenseNudge);
  if (licenseNudge && licenseNudge !== nudgeHref) setNudgeHref(licenseNudge);

  const sidebar = (
    <Sidebar user={user} projects={projects} current={current} version={version} pathname={pathname} unread={unread} backupAlert={backupAlert} updateAvailable={updateAvailable} diskLow={diskLow} releaseNav={releaseNav} />
  );

  return (
    // El diálogo de informar de un error cierra antes el menú móvil: la captura es de la página, no del menú.
    <FeedbackProvider status={feedback} isAdmin={user.role === "ADMIN"} version={version} email={user.email} beforeOpen={closeDrawer}>
    <ProjectsContext.Provider value={{ projects, currentId: current?.id ?? null }}>
    <NewProjectContext.Provider value={openNewProject}>
    {/* `unread` llega con tope de 100 (layout): con 100 o más la insignia pide 100 (algunos sistemas lo muestran como
        «99+»), nunca un número menor que el real. */}
    <AppBadge count={unread} />
    <SkipToContent />
    {/* Fijo al viewport: nunca hay scroll del documento. En Android con la barra de gestos dibujada
        encima (viewport-fit=cover) el contenido acaba justo antes de esa barra. */}
    <div className="fixed inset-0 flex overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} aria-hidden />
          {/* Cualquier enlace del menú lo cierra: el cierre por cambio de ruta no basta para los que se quedan en la
              misma («Archivadas» es `/p/<id>?archivadas=1`, el tablero que ya se ve). */}
          <aside id="app-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label={t("Menú")} className="absolute top-0 left-0 flex h-dvh max-h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-slate-900" onClick={(e) => { if ((e.target as Element).closest?.("a[href]")) setDrawerOpen(false); }}>
            <button ref={drawerCloseRef} className="btn-icon absolute top-3 right-3" onClick={() => setDrawerOpen(false)} aria-label={t("Cerrar menú")}>
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[env(safe-area-inset-top)] lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <button ref={drawerOpenerRef} className="btn-icon" onClick={() => setDrawerOpen(true)} aria-label={t("Abrir menú")} aria-expanded={drawerOpen} aria-haspopup="dialog" aria-controls={drawerOpen ? "app-drawer" : undefined}>
            <Menu size={20} />
          </button>
          {/* Deshacer, justo a continuación del nombre del tablero. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <ProjectMenu className="min-w-0" />
            {current && inProject && <UndoButton projectId={current.id} className="shrink-0" />}
          </div>
          {current && inProject && <Presence projectId={current.id} compact />}
          {unread > 0 && (
            <HoverPrefetchLink href="/notifications" className="ml-auto flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white" aria-label={unread > 99 ? t("Más de 99 avisos sin leer") : unread === 1 ? t("1 aviso sin leer") : t("{n} avisos sin leer", { n: unread })}>
              <Bell size={13} /> {unread > 99 ? "99+" : unread}
            </HoverPrefetchLink>
          )}
        </header>
        {nudgeHref && <LicenseNudge buyHref={nudgeHref} />}
        <main id={MAIN_ID} tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none max-lg:pb-[env(safe-area-inset-bottom)]">{children}</main>
      </div>
    </div>
    {creatingProject && <NewProjectModal isAdmin={user.role === "ADMIN"} onClose={() => setCreatingProject(false)} />}
    </NewProjectContext.Provider>
    </ProjectsContext.Provider>
    </FeedbackProvider>
  );
}

type ShellProject = Props["projects"][number];

/**
 * Lista de proyectos del selector y de la navegación: la del administrador («Proyectos en los que trabajo») y, mientras
 * está dentro de un proyecto de equipo que no tiene en ella, también ese, marcado `outside` («No está en tus
 * proyectos», con el botón para añadirlo). No se añade solo a la lista: abrir un proyecto no es elegirlo. Al cargar la
 * página lo trae el layout (`initial`); al llegar con la navegación de la app se pide al servidor. Quien no es
 * administrador tiene en su lista todos los proyectos a los que puede entrar: nunca hay uno fuera.
 */
function useOutsideListProject(user: CurrentUser, listed: ShellProject[], projectId: string | null, initial: { id: string; name: string } | null): ShellProject[] {
  const isAdmin = user.role === "ADMIN";
  const [outside, setOutside] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if ((initial?.id ?? "") + (initial?.name ?? "") !== (seen?.id ?? "") + (seen?.name ?? "")) {
    setSeen(initial);
    if (initial) setOutside(initial);
  }
  const inList = !!projectId && listed.some((p) => p.id === projectId);
  const wanted = isAdmin && projectId && !inList && outside?.id !== projectId ? projectId : null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    projectOutsideList(wanted).then((res) => { if (live && res.ok && res.data) setOutside(res.data); }, () => {});
    return () => { live = false; };
  }, [wanted]);
  if (!isAdmin || !projectId || inList || outside?.id !== projectId) return listed;
  return [...listed, { id: outside.id, name: outside.name, isPrivate: false, outside: true }];
}

function NavLink({ href, icon: Icon, children, active, extra, highlight = false }: { href: string; icon: typeof Menu; children: React.ReactNode; active: boolean; extra?: Record<string, unknown>; highlight?: boolean }) {
  // Se precarga al pasar el ratón, no al verse: cada router.refresh() del tablero repetía la precarga de todos.
  return (
    <HoverPrefetchLink
      href={href}
      {...extra}
      aria-current={active ? "page" : undefined}
      className={cn(
        // El contorno de foco va por dentro: el menú hace scroll y recortaría uno exterior.
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        highlight && "bg-brand-100 text-brand-700 outline-2 -outline-offset-2 outline-dashed outline-brand-500 dark:bg-brand-500/25 dark:text-brand-100",
        !highlight && active
          ? "bg-brand-50 text-brand-700 shadow-[inset_3px_0_0_var(--color-detail)] dark:bg-brand-500/15 dark:text-brand-100"
          : !highlight && "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
      )}
    >
      <Icon size={17} />
      {children}
    </HoverPrefetchLink>
  );
}

/** «Documentación»: acepta archivos arrastrados desde el escritorio y los sube a la documentación del proyecto. */
function DocsNavLink({ projectId, active }: { projectId: string; active: boolean }) {
  const t = useT();
  const router = useRouter();
  const safeRefresh = useSafeRefresh();
  const toast = useToast();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const open = () => router.push(`/p/${projectId}/docs`);

  async function upload(files: File[]) {
    toast(files.length === 1 ? t("Subiendo «{name}» a Documentación…", { name: files[0]!.name }) : t("Subiendo {n} archivos a Documentación…", { n: files.length }));
    let done = 0;
    const failed: { name: string; error: string }[] = [];
    for (const file of files) {
      const res = await uploadDocument(projectId, file, t);
      if (res.ok) done++;
      else failed.push({ name: documentUploadName(file, t), error: res.error });
    }
    if (done > 0) {
      toast(done === 1 ? t("Documento subido") : t("{n} documentos subidos", { n: done }), "success", { label: t("Abrir Documentación"), onClick: open });
      safeRefresh();
    }
    // Cuáles no se han subido y por qué (p. ej. con la cuota superada), no solo cuántos.
    const failedMsg = documentFailuresMessage(t, failed, files.length);
    if (failedMsg) toast(failedMsg, "error");
  }

  const extra = {
    "data-docs-drop": "",
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = filesFrom(e.dataTransfer.files);
      if (files.length) void upload(files);
    },
  };
  return <NavLink href={`/p/${projectId}/docs`} icon={FileText} active={active} extra={extra} highlight={over}>{t("Documentación")}</NavLink>;
}

function Sidebar({ user, projects, current, version, pathname, unread, backupAlert, updateAvailable, diskLow, releaseNav }: {
  releaseNav: Props["releaseNav"];
  unread: number;
  backupAlert: boolean | "shrunk";
  updateAvailable: boolean;
  diskLow: boolean;
  user: CurrentUser;
  projects: ShellProject[];
  current: ShellProject | null;
  version: string;
  pathname: string;
}) {
  const t = useT();
  const isAdmin = user.role === "ADMIN";
  // «Releases» solo en proyectos con columna «Siguiente salto» o con alguna release (y siempre si se está en esa sección).
  const usesReleases = useReleaseNav(current?.id ?? "", releaseNav && releaseNav.id === current?.id ? releaseNav.show : undefined);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <BrandMark size={26} />
        <span className="text-lg font-bold tracking-tight">Pizarro</span>
      </div>

      <div className="px-3">
        <ProjectSwitcher projects={projects} current={current} isAdmin={isAdmin} />
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
        {current && (
          <>
            <NavLink href={`/p/${current.id}`} icon={LayoutDashboard} active={pathname === `/p/${current.id}`}>{t("Tablero")}</NavLink>
            {(usesReleases || pathname.startsWith(`/p/${current.id}/releases`)) && <NavLink href={`/p/${current.id}/releases`} icon={Rocket} active={pathname.startsWith(`/p/${current.id}/releases`)}>{t("Releases")}</NavLink>}
            <DocsNavLink projectId={current.id} active={pathname.startsWith(`/p/${current.id}/docs`)} />
            <ReportButton projectId={current.id} />
            <NavLink href={`/p/${current.id}/settings`} icon={SlidersHorizontal} active={pathname.startsWith(`/p/${current.id}/settings`)}>{t("Ajustes del proyecto")}</NavLink>
            <NavLink href={`/p/${current.id}?archivadas=1`} icon={Archive} active={false}>{t("Archivadas")}</NavLink>
            <div className="my-3 border-t border-slate-200 dark:border-slate-800" />
          </>
        )}
        <NavLink href="/notifications" icon={Bell} active={pathname === "/notifications"}>
          <span className="flex-1">{t("Avisos")}</span>
          {unread > 0 && (
            <>
              {/* Un aria-label en un <span> sin rol no cuenta para el nombre del enlace (quedaba «Avisos» a secas): el número
                  se ve, y el texto para el lector de pantalla va aparte. */}
              <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" aria-hidden>{unread > 99 ? "99+" : unread}</span>
              <span className="sr-only">{unread > 99 ? t("Más de 99 sin leer") : t("{n} sin leer", { n: unread })}</span>
            </>
          )}
        </NavLink>
        <NavLink href="/my-tasks" icon={ListChecks} active={pathname === "/my-tasks"}>{t("Mis tareas asignadas")}</NavLink>
        <NavLink href="/calendar" icon={CalendarDays} active={pathname === "/calendar"}>{t("Calendario")}</NavLink>
        <NavLink href="/settings" icon={Settings} active={pathname === "/settings"}>{t("Mi perfil")}</NavLink>
        {isAdmin && <NavLink href="/admin/users" icon={Shield} active={pathname.startsWith("/admin")}>
          <span className="flex-1">{t("Administración")}</span>
          {backupAlert && (
            <span
              className="h-2 w-2 rounded-full bg-amber-500" role="img"
              aria-label={backupAlert === "shrunk" ? t("La última copia es mucho menor que la anterior") : t("Copia de seguridad atrasada")}
              title={backupAlert === "shrunk" ? t("La última copia es mucho menor que la anterior") : t("Copia de seguridad atrasada")}
            />
          )}
          {diskLow && <span className="h-2 w-2 rounded-full bg-red-500" role="img" aria-label={t("El disco del servidor está casi lleno")} title={t("El disco del servidor está casi lleno")} />}
          {updateAvailable && <span className="h-2 w-2 rounded-full bg-sky-500" role="img" aria-label={t("Hay una versión nueva de Pizarro")} title={t("Hay una versión nueva de Pizarro")} />}
        </NavLink>}
        <InstallApp />
      </nav>

      {/* Pie con margen seguro: en el móvil la barra de gestos o la del navegador pueden quedar encima (viewport-fit=cover);
          el margen se suma al de siempre, y el menú mide lo visible de la pantalla (h-dvh), no la altura con la barra oculta. */}
      <div className="border-t border-slate-200 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Avatar id={user.id} name={user.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            {/* El historial se abre desde aquí (ronda 72: ya no tiene entrada en el menú), también en el menú del móvil. */}
            <HoverPrefetchLink
              href="/changelog"
              className="text-xs text-slate-500 hover:underline dark:text-slate-400"
              aria-label={t("Historial de versiones (v{version})", { version })}
              title={t("Historial de versiones (v{version})", { version })}
              aria-current={pathname === "/changelog" ? "page" : undefined}
            >
              v{version}
            </HoverPrefetchLink>
          </div>
          <FeedbackButton />
          <form action={logout} onSubmit={() => clearDraftsOnLogout(user.clearDraftsOnLogout)}>
            <button type="submit" className="btn-icon" title={t("Cerrar sesión")} aria-label={t("Cerrar sesión")}>
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Abre «Nuevo proyecto» (lo pinta Shell, fuera del menú móvil). */
const NewProjectContext = createContext<() => void>(() => {});

function ProjectSwitcher({ projects, current, isAdmin }: { projects: ShellProject[]; current: ShellProject | null; isAdmin: boolean }) {
  const t = useT();
  const switchHref = useProjectSwitchHref();
  const openNewProject = useContext(NewProjectContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Alt+P (atajo del tablero) abre este selector en escritorio, donde la cabecera del tablero ya no lleva el suyo. Solo
  // el que se ve: en el móvil la barra lateral está oculta y responde el de la barra superior (ProjectMenu).
  useEffect(() => {
    const onShortcut = () => {
      if (rootRef.current && rootRef.current.getClientRects().length > 0) setOpen(true);
    };
    window.addEventListener(OPEN_PROJECT_MENU_EVENT, onShortcut);
    return () => window.removeEventListener(OPEN_PROJECT_MENU_EVENT, onShortcut);
  }, []);
  return (
    <div className="relative" ref={rootRef}>
      <DropdownMenu
        matchWidth
        open={open}
        onOpenChange={setOpen}
        label={t("Selecciona proyecto")}
        panelClassName="rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        trigger={({ props }) => (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
            {...props}
          >
            <FolderKanban size={16} className="shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1 truncate font-medium">{current?.name ?? t("Selecciona proyecto")}</span>
            {current?.isPrivate && <PrivateIcon />}
            <ChevronsUpDown size={15} className="shrink-0 text-slate-400" />
          </button>
        )}
      >
        {projects.length === 0 && <div className="px-2.5 py-2 text-sm text-slate-500">{t("No tienes proyectos.")}</div>}
        {projects.map((p) => (
          <Link
            key={p.id}
            href={switchHref(p.id)}
            role="menuitem"
            tabIndex={-1}
            aria-current={p.id === current?.id ? "true" : undefined}
            className={cn(
              "block truncate rounded-md px-2.5 py-2 text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
              p.id === current?.id && "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate">{p.name}</span>
              {p.isPrivate && <PrivateIcon />}
            </span>
            {p.outside && <span className="block text-xs font-normal text-slate-500">{t("No está en tus proyectos")}</span>}
          </Link>
        ))}
        {isAdmin && (
          <Link
            href="/projects"
            role="menuitem"
            tabIndex={-1}
            className="mt-1 block rounded-md border-t border-slate-200 px-2.5 py-2 text-sm text-brand-600 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:border-slate-800 dark:text-brand-300 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
          >
            {t("Ver proyectos existentes")}
          </Link>
        )}
        {/* Para todos: quien no es administrador crea proyectos privados (el diálogo lo indica y el servidor lo exige). */}
        <MenuItem icon={Plus} className="rounded-md text-brand-600 dark:text-brand-300" onClick={openNewProject}>
          {t("Nuevo proyecto")}
        </MenuItem>
      </DropdownMenu>
      {current?.outside && <OutsideListNotice projectId={current.id} />}
    </div>
  );
}

/** «template:id» → el id; «blank» → "". */
const templateIdOf = (value: string) => (value.startsWith("template:") ? value.slice("template:".length) : "");

/** Botón «Nuevo proyecto» fuera del selector (la portada sin proyectos): abre el mismo diálogo. */
export function NewProjectButton({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
        <Plus size={16} /> {t("Nuevo proyecto")}
      </button>
      {creating && <NewProjectModal isAdmin={isAdmin} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProjectModal({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useActionTransition();
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);
  // Plantillas con las que empezar: las de serie de la instalación y las propias.
  const [starts, setStarts] = useState<{ id: string; name: string; description: string; builtin: boolean; examples: boolean }[]>([]);
  // Con qué empieza el proyecto: en blanco ("") o el id de una plantilla.
  const [templateId, setTemplateId] = useState("");
  // «Con tarjetas de ejemplo» (solo con una plantilla de serie que las tenga); desmarcada por defecto.
  const [withExamples, setWithExamples] = useState(false);
  // Último nombre puesto por el autocompletado de una plantilla: solo se sustituye o se quita mientras siga sin tocarse.
  const autoName = useRef("");
  // Quien no es administrador solo puede crear proyectos privados.
  const [isPrivate, setIsPrivate] = useState(!isAdmin);
  // «Importar desde un archivo…» (solo administradores) cambia el contenido del diálogo.
  const [importing, setImporting] = useState(false);
  // Con una importación en curso el diálogo no se cierra (Esc, fondo, atrás): la subida sigue y se enseña su resultado.
  const [importBusy, setImportBusy] = useState(false);
  // El foco va al nombre al abrir y no un fotograma después (Modal), así que lo que se escribe justo tras pulsar «Nuevo
  // proyecto» ya entra aquí (antes se perdía la primera letra). En un efecto y no con `autoFocus`: este corre después del
  // del Modal, que así guarda como «anterior» el botón que lo abrió y le devuelve el foco al cerrar (con `autoFocus`, que
  // React aplica antes, guardaba el propio campo y el foco acababa en <body>).
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  // Sin red se piden al volver la conexión (antes el fallo quedaba sin atender).
  useEffect(() => loadWhenOnline(listProjectStarts, (res) => res.ok && setStarts(res.data), () => {}), []);
  // Se cierra al llegar al proyecto nuevo, no antes: cerrar retira su entrada del historial
  // y eso cancelaría la navegación en curso.
  useEffect(() => {
    if (target && pathname === target) onClose();
  }, [target, pathname, onClose]);
  const builtins = starts.filter((tpl) => tpl.builtin);
  const own = starts.filter((tpl) => !tpl.builtin);
  const template = templateId ? starts.find((tpl) => tpl.id === templateId) : undefined;
  const examples = !!template?.examples && withExamples;
  // La línea que describe la opción elegida. Sin descripción, la genérica, que con ejemplos no dice a la vez «sin
  // tarjetas» y «con tarjetas».
  const description = template?.description.trim() ?? "";
  const originHelp = !template
    ? t("Columnas por defecto, sin tarjetas.")
    : examples
      ? description
        ? t("{description} Con tarjetas de muestra que puedes borrar.", { description })
        : t("La estructura de la plantilla (columnas, tipos, etiquetas y campos), con tarjetas de muestra que puedes borrar.")
      : description || t("La estructura de la plantilla (columnas, tipos, etiquetas y campos), sin tarjetas.");
  // Elegir una plantilla propone su nombre (si el campo está vacío o aún tiene el que puso otra); en blanco lo quita.
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const picked = id ? starts.find((tpl) => tpl.id === id) : undefined;
    const untouched = !name.trim() || name === autoName.current;
    if (picked) {
      if (untouched) { setName(picked.name); autoName.current = picked.name; }
    } else {
      if (autoName.current && name === autoName.current) setName("");
      autoName.current = "";
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createProject(name, { templateId: template ? template.id : null, withExamples: examples, isPrivate });
      if (!res.ok) return toast(res.error, "error");
      // Con una plantilla, al tablero: ya trae columnas, tipos y etiquetas, y lo siguiente es crear tareas (antes se abrían
      // siempre los ajustes). En blanco, a los ajustes, para adaptar las columnas por defecto y los tipos.
      // Con una plantilla, el tablero enseña la descripción del proyecto una vez (ProjectIntroNotice).
      const dest = template ? `/p/${res.data.id}` : `/p/${res.data.id}/settings`;
      if (template) showProjectIntroOnce(res.data.id, description);
      setTarget(dest);
      router.push(dest);
    });
  };
  return (
    <Modal open onClose={importBusy ? () => {} : onClose} title={t("Nuevo proyecto")} size={importing ? "md" : "sm"}>
      {importing ? (
        <ImportProjectPanel
          isPrivate={isPrivate}
          onBack={() => setImporting(false)}
          onClose={onClose}
          onBusyChange={setImportBusy}
          privateToggle={
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPrivate} disabled={importBusy} onChange={(e) => setIsPrivate(e.target.checked)} />
              <span className="whitespace-nowrap">{t("Crear como proyecto privado inicialmente")}</span>
            </label>
          }
        />
      ) : (
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="project-name">{t("Nombre")}</label>
          <input ref={nameRef} id="project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-autofocus />
        </div>
        {/* Un solo desplegable: en blanco, una plantilla de serie o una propia. Siempre visible (las plantillas
            llegan al momento y se añaden sin mover nada); debajo, una línea que describe la opción y, con una de serie, la
            casilla de las tarjetas de ejemplo. */}
        <div>
          <label className="label" htmlFor="project-start">{t("Empezar con")}</label>
          <select
            id="project-start"
            className="input"
            value={template ? `template:${template.id}` : "blank"}
            aria-describedby="project-start-help"
            onChange={(e) => pickTemplate(templateIdOf(e.target.value))}
          >
            <option value="blank">{t("Proyecto en blanco")}</option>
            {builtins.length > 0 && (
              <optgroup label={t("Plantillas de serie")}>
                {builtins.map((tpl) => <option key={tpl.id} value={`template:${tpl.id}`}>{tpl.name}</option>)}
              </optgroup>
            )}
            {own.length > 0 && (
              <optgroup label={t("Plantillas propias")}>
                {own.map((tpl) => <option key={tpl.id} value={`template:${tpl.id}`}>{tpl.name}</option>)}
              </optgroup>
            )}
          </select>
          {/* Se lee entera con las de serie (en el móvil, recortada, se perdía justo «Con tarjetas de muestra…»); solo una
              propia, con una descripción que puede ser larga, se recorta. */}
          <p id="project-start-help" className={cn("mt-1 text-xs text-slate-500", template && !template.builtin && "line-clamp-4")}>{originHelp}</p>
          {template?.examples && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withExamples} onChange={(e) => setWithExamples(e.target.checked)} />
              <span>{t("Con tarjetas de ejemplo")}</span>
            </label>
          )}
        </div>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            <span className="whitespace-nowrap">{t("Crear como proyecto privado inicialmente")}</span>
          </label>
        ) : (
          <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <PrivateIcon /> {t("Será un proyecto privado: solo lo verás tú hasta que añadas más miembros.")}
          </p>
        )}
        {/* Pie: el enlace discreto de importar a la izquierda; si no cabe en la misma línea (móvil), los botones bajan. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 pt-1">
          {isAdmin && (
            <button type="button" className="shrink-0 whitespace-nowrap text-sm text-slate-500 underline underline-offset-2 hover:text-brand-600" onClick={() => setImporting(true)}>
              {t("Importar desde un archivo…")}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
            <button type="submit" className="btn-primary" disabled={pending || !!target || !name.trim()}>{t("Crear")}</button>
          </div>
        </div>
      </form>
      )}
    </Modal>
  );
}
