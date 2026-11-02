import Link from "next/link";
import { listVisibleProjects } from "@/lib/access";
import { listKinds } from "@/lib/board";
import { cn } from "@/components/ui/cn";
import { db } from "@/lib/db";
import { listTemplatesSorted, missingBuiltinKeys } from "@/lib/template-store";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { KindsAdmin } from "../types/KindsAdmin";
import { TemplatesAdmin } from "./TemplatesAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Tipos y plantillas") };
}

type Search = Promise<{ vista?: string | string[] }>;

/** «Tipos y plantillas»: dos listados de catálogo (tipos de tarea generales y plantillas de proyecto) en una sola pestaña. */
export default async function TemplatesPage({ searchParams }: { searchParams: Search }) {
  const user = await requireAdminPage();
  const t = await getT();
  const sp = await searchParams;
  const vista = (Array.isArray(sp.vista) ? sp.vista[0] : sp.vista) === "tipos" ? "tipos" : "plantillas";
  const me = await db.user.findUnique({ where: { id: user.id }, select: { editorMode: true } });
  const editorMode = me?.editorMode ?? "MARKDOWN";
  const views = [
    { id: "plantillas", href: "/admin/templates", label: t("Plantillas de proyecto") },
    { id: "tipos", href: "/admin/templates?vista=tipos", label: t("Tipos de tarea") },
  ];
  const switcher = (
    <nav className="flex gap-1" aria-label={t("Tipos y plantillas")} data-testid="catalog-switch">
      {views.map((v) => (
        <Link
          key={v.id}
          href={v.href}
          aria-current={v.id === vista ? "page" : undefined}
          className={cn("rounded-full px-3 py-1 text-sm font-medium", v.id === vista ? "bg-brand-600 text-on-brand" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700")}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );

  if (vista === "tipos") {
    const [kinds, counts] = await Promise.all([listKinds(), db.task.groupBy({ by: ["kindId"], _count: { _all: true } })]);
    const usage = Object.fromEntries(counts.map((c) => [c.kindId, c._count._all]));
    return (
      <div className="space-y-4">
        {switcher}
        <KindsAdmin editorMode={editorMode} kinds={kinds.map((k) => ({ ...k, taskCount: usage[k.id] ?? 0 }))} />
      </div>
    );
  }
  const [templates, missing, kinds, projects] = await Promise.all([
    listTemplatesSorted(db),
    missingBuiltinKeys(db),
    listKinds(),
    listVisibleProjects(user, { all: true }),
  ]);
  return (
    <div className="space-y-4">
      {switcher}
      <TemplatesAdmin templates={templates} missingBuiltins={missing.length} generalKinds={kinds.map((k) => k.name)} projects={projects} editorMode={editorMode} />
    </div>
  );
}
