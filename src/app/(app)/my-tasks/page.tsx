import Link from "next/link";
import { ExternalLink, ListChecks } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { TypeBadge } from "@/components/ui/TypeBadge";

export const metadata = { title: "Mis tareas" };

export default async function MyTasksPage() {
  const user = await requireUserPage();
  const tasks = await db.task.findMany({
    where: { assigneeId: user.id, archivedAt: null, project: visibleProjectsWhere(user) },
    orderBy: [{ project: { position: "asc" } }, { column: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      title: true,
      type: true,
      color: true,
      linkUrl: true,
      project: { select: { id: true, name: true } },
      column: { select: { name: true, role: true } },
      subtasks: { select: { done: true } },
    },
  });

  const byProject = new Map<string, { name: string; tasks: typeof tasks }>();
  for (const t of tasks) {
    const group = byProject.get(t.project.id) ?? { name: t.project.name, tasks: [] };
    group.tasks.push(t);
    byProject.set(t.project.id, group);
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">Mis tareas asignadas</h1>
      <p className="mb-6 text-sm text-slate-500">{tasks.length} tarea(s) en todos tus proyectos.</p>
      {tasks.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-sm text-slate-500">
          <ListChecks size={32} className="text-slate-300" /> No tienes tareas asignadas.
        </div>
      )}
      <div className="space-y-6">
        {[...byProject.entries()].map(([projectId, group]) => (
          <section key={projectId}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
              <Link href={`/p/${projectId}`} className="hover:underline">{group.name}</Link>
              <span className="text-xs font-normal text-slate-400">{group.tasks.length}</span>
            </h2>
            <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
              {group.tasks.map((t) => {
                const done = t.subtasks.filter((s) => s.done).length;
                return (
                  <li key={t.id} className="relative flex items-center gap-3 px-4 py-2.5">
                    {t.color && <span className="absolute inset-y-1 left-0 w-1 rounded-r" style={{ backgroundColor: t.color }} aria-hidden />}
                    <TypeBadge type={t.type} />
                    <Link href={`/p/${projectId}?task=${t.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                      {t.title}
                    </Link>
                    {t.subtasks.length > 0 && <span className="text-xs text-slate-500">{done}/{t.subtasks.length}</span>}
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t.column.name}
                    </span>
                    {t.linkUrl && (
                      <a href={t.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-slate-400 hover:text-brand-600" aria-label="Enlace externo">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
