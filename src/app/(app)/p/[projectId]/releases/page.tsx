import { notFound } from "next/navigation";
import { Rocket } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { ReleaseEntry } from "./ReleaseEntry";

export const metadata = { title: "Releases" };

export default async function ReleasesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: {
      name: true,
      releases: {
        orderBy: { deployedAt: "desc" },
        take: 200,
        select: {
          id: true,
          title: true,
          content: true,
          deployedAt: true,
          createdBy: { select: { name: true } },
          _count: { select: { tasks: true } },
        },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">Releases</h1>
      <p className="mb-6 text-sm text-slate-500">Histórico de despliegues de «{project.name}» con el texto final editado.</p>
      {project.releases.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
          <Rocket size={32} className="text-slate-300" />
          Aún no hay releases. Genera una desde la columna «Siguiente salto a producción» del tablero.
        </div>
      ) : (
        <div className="space-y-3">
          {project.releases.map((r) => (
            <ReleaseEntry
              key={r.id}
              release={{
                id: r.id,
                title: r.title,
                content: r.content,
                deployedAt: r.deployedAt.toISOString(),
                author: r.createdBy?.name ?? null,
                taskCount: r._count.tasks,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
