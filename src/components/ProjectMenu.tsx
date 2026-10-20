"use client";

import { Check, ChevronDown, Lock } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { cn } from "./ui/cn";

interface ProjectsValue {
  projects: { id: string; name: string; isPrivate?: boolean }[];
  currentId: string | null;
}

/** Candado discreto junto al nombre de un proyecto privado. */
export function PrivateIcon({ className }: { className?: string }) {
  return <Lock size={14} className={cn("shrink-0 text-slate-400", className)} aria-label="Proyecto privado" role="img"><title>Proyecto privado</title></Lock>;
}

export const ProjectsContext = createContext<ProjectsValue>({ projects: [], currentId: null });

/** Título del proyecto actual que abre un desplegable para cambiar de proyecto al instante. */
export function ProjectMenu({ className, textClassName }: { className?: string; textClassName?: string }) {
  const { projects, currentId } = useContext(ProjectsContext);
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.id === currentId);
  if (!current) return <span className={cn("truncate font-semibold", textClassName)}>Pizarro</span>;

  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("truncate font-semibold", textClassName)}>{current.name}</span>
        {current.isPrivate && <PrivateIcon />}
        <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <ul role="listbox" className="absolute left-0 z-50 mt-1 max-h-[60vh] w-72 max-w-[85vw] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            {projects.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === currentId}>
                <Link
                  href={`/p/${p.id}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                    p.id === currentId && "font-semibold text-brand-700 dark:text-brand-100",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.isPrivate && <PrivateIcon />}
                  {p.id === currentId && <Check size={15} />}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
