"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setMyProjectPicks } from "@/actions/projects";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

export interface PickProject {
  id: string;
  name: string;
  isPrivate: boolean;
  picked: boolean;
}

/**
 * «Proyectos en los que trabajo» (solo administradores): los elegidos salen en el selector, el menú y los filtros.
 * Los administradores pueden abrir igualmente cualquier proyecto de equipo; los privados aparecen siempre.
 */
export function ProjectPicksSection({ projects }: { projects: PickProject[] }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(new Set(projects.filter((p) => p.picked).map((p) => p.id)));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section id="proyectos" className="card scroll-mt-4 p-5">
      <h2 className="font-semibold">{t("Proyectos en los que trabajo")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Solo estos proyectos salen en tus selectores y menús. Como administrador puedes abrir cualquier proyecto de equipo desde Administración.")}</p>
      <ul className="mt-3 max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {projects.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-brand-600"
                disabled={p.isPrivate}
                checked={p.isPrivate || picked.has(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.isPrivate && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  <Lock size={12} /> {t("Privado, siempre aparece")}
                </span>
              )}
            </label>
          </li>
        ))}
        {projects.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{t("No hay proyectos.")}</li>}
      </ul>
      <button
        className="btn-primary mt-4"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setMyProjectPicks([...picked]);
            toast(res.ok ? t("Proyectos actualizados") : res.error, res.ok ? "success" : "error");
            if (res.ok) router.refresh();
          })
        }
      >
        {t("Guardar")}
      </button>
    </section>
  );
}
