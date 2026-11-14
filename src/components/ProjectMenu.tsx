"use client";

import { Check, ChevronDown, FolderPlus, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { projectSwitchPath } from "@/lib/project-path";
import { OPEN_PROJECT_MENU_EVENT, useShortcut } from "./board/shortcuts";
import { addProjectToMine } from "@/actions/project-visit";
import { useActionTransition } from "./useActionTransition";
import { useSafeRefresh } from "./useSafeRefresh";
import { cn } from "./ui/cn";
import { Menu, MenuItem } from "./ui/Menu";
import { useToast } from "./ui/Toast";

interface ProjectsValue {
  /** `outside`: el proyecto abierto no está en «Proyectos en los que trabajo» del administrador (AppShell). */
  projects: { id: string; name: string; isPrivate?: boolean; outside?: boolean }[];
  currentId: string | null;
}

/** Candado discreto junto al nombre de un proyecto privado. */
export function PrivateIcon({ className }: { className?: string }) {
  const t = useT();
  return <Lock size={14} className={cn("ml-1 shrink-0 text-slate-400", className)} aria-label={t("Proyecto privado")} role="img"><title>{t("Proyecto privado")}</title></Lock>;
}

export const ProjectsContext = createContext<ProjectsValue>({ projects: [], currentId: null });

/** Añade a «Proyectos en los que trabajo» el proyecto abierto que no estaba (al refrescar deja de salir marcado). */
function useAddToMine(projectId: string) {
  const t = useT();
  const toast = useToast();
  const safeRefresh = useSafeRefresh();
  const [pending, start] = useActionTransition();
  const add = () =>
    start(async () => {
      const res = await addProjectToMine(projectId);
      if (!res.ok) return toast(res.error, "error");
      toast(t("Proyecto añadido a tus proyectos"));
      safeRefresh();
    });
  return { add, pending };
}

/**
 * Bajo el selector de la barra lateral: el proyecto abierto no está en la lista del administrador. No se añade solo
 * (abrirlo por un enlace o un aviso no es elegirlo); el botón lo añade.
 */
export function OutsideListNotice({ projectId }: { projectId: string }) {
  const t = useT();
  const { add, pending } = useAddToMine(projectId);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-slate-500" data-testid="outside-list-notice">
      <span>{t("No está en tus proyectos")}</span>
      <button type="button" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline disabled:opacity-60 dark:text-brand-300" disabled={pending} onClick={add}>
        <FolderPlus size={13} /> {t("Añadir a mis proyectos")}
      </button>
    </div>
  );
}

function AddToMineItem({ projectId }: { projectId: string }) {
  const t = useT();
  const { add, pending } = useAddToMine(projectId);
  return <MenuItem icon={FolderPlus} className="rounded-lg text-brand-600" disabled={pending} onClick={add}>{t("Añadir a mis proyectos")}</MenuItem>;
}

/** Destino al cambiar de proyecto: la misma página (ajustes, releases, tablero…) en el proyecto elegido. */
export function useProjectSwitchHref(): (projectId: string) => string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (projectId) => projectSwitchPath(pathname, search, projectId);
}

/** Título del proyecto actual que abre un desplegable para cambiar de proyecto al instante. */
export function ProjectMenu({ className, textClassName }: { className?: string; textClassName?: string }) {
  const t = useT();
  const { projects, currentId } = useContext(ProjectsContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sc = useShortcut();
  const current = projects.find((p) => p.id === currentId);
  const switchHref = useProjectSwitchHref();

  // Alt+P abre el desplegable (solo el que se ve: en la cabecera hay uno para escritorio y otro para móvil).
  useEffect(() => {
    const onShortcut = () => {
      if (rootRef.current && rootRef.current.getClientRects().length > 0) setOpen(true);
    };
    window.addEventListener(OPEN_PROJECT_MENU_EVENT, onShortcut);
    return () => window.removeEventListener(OPEN_PROJECT_MENU_EVENT, onShortcut);
  }, []);
  if (!current) return <span className={cn("truncate font-semibold", textClassName)}>Pizarro</span>;

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      wrapperRef={rootRef}
      className={cn("min-w-0", className)}
      label={t("Cambiar de proyecto ({keys})", { keys: sc("Alt+P") })}
      panelClassName="w-72 max-w-[85vw] rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      trigger={({ open: isOpen, props }) => (
        <button
          type="button"
          className="flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          // Nombre completo en el tooltip: con poco sitio se ve truncado con «…».
          title={`${current.name}\n${t("Cambiar de proyecto ({keys})", { keys: sc("Alt+P") })}`}
          {...props}
        >
          <span data-project-name className={cn("truncate font-semibold", textClassName)}>{current.name}</span>
          {current.isPrivate && <PrivateIcon />}
          <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} />
        </button>
      )}
    >
      {projects.map((p) => (
        <Link
          key={p.id}
          href={switchHref(p.id)}
          role="menuitem"
          tabIndex={-1}
          aria-current={p.id === currentId ? "true" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
            p.id === currentId && "font-semibold text-brand-700 dark:text-brand-100",
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {p.name}
            {p.outside && <span className="block text-xs font-normal text-slate-500">{t("No está en tus proyectos")}</span>}
          </span>
          {p.isPrivate && <PrivateIcon />}
          {p.id === currentId && <Check size={15} />}
        </Link>
      ))}
      {current.outside && <AddToMineItem projectId={current.id} />}
    </Menu>
  );
}
