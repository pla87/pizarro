"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setAdminProjectPick } from "@/actions/projects";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

interface Row {
  id: string;
  name: string;
  picked: boolean;
}

/** Lista de proyectos de equipo con el botón para añadirlos (o quitarlos) de los proyectos de trabajo del administrador. */
export function ExistingProjects({ projects, userId }: { projects: Row[]; userId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const toggle = (p: Row) =>
    start(async () => {
      const res = await setAdminProjectPick(p.id, userId, !p.picked);
      if (!res.ok) return toast(res.error, "error");
      toast(p.picked ? t("Proyecto quitado de tus proyectos") : t("Proyecto añadido a tus proyectos"));
      router.refresh();
    });
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">{t("Proyectos existentes")}</h1>
      <p className="text-sm text-slate-500">{t("Todos los proyectos de equipo a los que tienes acceso. Añade a tus proyectos los que quieras ver en selectores, menús y calendario.")}</p>
      {projects.length === 0 && <p className="card p-5 text-sm text-slate-500">{t("No hay proyectos de equipo.")}</p>}
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="card flex flex-wrap items-center gap-2 p-3">
            <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
            {p.picked && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Check size={13} /> {t("En mis proyectos")}</span>
            )}
            <Link href={`/p/${p.id}`} className="btn-secondary">{t("Abrir")}</Link>
            <button type="button" className={p.picked ? "btn-secondary" : "btn-primary"} disabled={pending} onClick={() => toggle(p)}>
              {p.picked ? t("Quitar de mis proyectos") : t("Añadir a mis proyectos")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
