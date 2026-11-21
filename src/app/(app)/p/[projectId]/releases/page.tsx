import { notFound } from "next/navigation";
import { Rocket } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { COLUMN_ROLE_LABEL } from "@/lib/constants";
import { db } from "@/lib/db";
import { searchReleaseIds } from "@/lib/release-search";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { projectSectionMetadata } from "../project-title";
import { ReleasesList } from "./ReleasesList";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  return projectSectionMetadata(params, t("Releases"));
}

const PAGE_STEP = 50;
/**
 * Releases que puede mostrar la página como mucho, con «Cargar más» (?limit=) o con búsqueda. Solo va la cabecera de
 * cada una: el texto (hasta MAX_RELEASE_CONTENT, 200 KB) se pide al desplegarla (getReleaseContent). Las más antiguas se
 * encuentran buscando.
 */
const LIST_MAX = 200;

export default async function ReleasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string | string[]; limit?: string | string[] }>;
}) {
  const user = await requireUserPage();
  const t = await getT();
  const { projectId } = await params;
  const sp = await searchParams;
  // Sin NUL (PostgreSQL no lo admite en un texto: ?q=a%00b daba el error 22021 y la página de error).
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.replaceAll("\u0000", "").trim().slice(0, 200) ?? "";
  const rawLimit = Number(Array.isArray(sp.limit) ? sp.limit[0] : sp.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= PAGE_STEP ? Math.min(Math.floor(rawLimit), LIST_MAX) : PAGE_STEP;
  // Primero el acceso: la búsqueda no debe tocar proyectos ajenos.
  if (!(await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user) } }))) notFound();
  // Con búsqueda se recorre todo el histórico del proyecto (hasta LIST_MAX coincidencias, las más recientes); sin ella, las últimas `limit`.
  // Sin distinguir mayúsculas ni tildes: se comparan ambos lados en minúsculas y sin acentos (con índice: release-search.ts).
  let where: { id?: { in: string[] } } = {};
  // Más coincidencias que LIST_MAX: se avisa (se pide una de más para saberlo).
  let searchTruncated = false;
  if (q) {
    const ids = await searchReleaseIds(projectId, q, LIST_MAX + 1);
    searchTruncated = ids.length > LIST_MAX;
    where = { id: { in: ids.slice(0, LIST_MAX) } };
  }
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: {
      name: true,
      _count: { select: { releases: true } },
      releases: {
        where,
        orderBy: { deployedAt: "desc" },
        ...(q ? {} : { take: limit + 1 }),
        select: {
          id: true,
          number: true,
          title: true,
          deployedAt: true,
          createdBy: { select: { name: true } },
          attachments: { orderBy: { position: "asc" }, select: { fileName: true } },
        },
      },
    },
  });
  if (!project) notFound();
  // Para el texto sin releases: el nombre real de la columna que las genera (cada proyecto la llama como quiere).
  const nextColumn = project._count.releases === 0 ? await db.column.findFirst({ where: { projectId, role: "NEXT_RELEASE" }, select: { name: true } }) : null;
  const hasMore = !q && project.releases.length > limit;
  const releases = hasMore ? project.releases.slice(0, limit) : project.releases;
  // Tareas de cada release mostrada, filtrando por sus ids: un `_count` de relación agruparía en cada carga todas las
  // ReleaseTask del servidor (Prisma 7 lo hace con un LEFT JOIN a un GROUP BY sin filtro).
  const taskGroups = releases.length
    ? await db.releaseTask.groupBy({ by: ["releaseId"], where: { releaseId: { in: releases.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const taskCount = new Map(taskGroups.map((g) => [g.releaseId, g._count._all]));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">{t("Releases")}</h1>
      <p className="mb-6 text-sm text-slate-500">{t("Histórico de despliegues de «{name}».", { name: project.name })}</p>
      {project._count.releases === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
          <Rocket size={32} className="text-slate-300" />
          {nextColumn
            ? t("Aún no hay releases. Genera una desde la columna «{name}» del tablero.", { name: nextColumn.name })
            : t("Aún no hay releases. Para generarlas, elige en el menú de una columna del tablero el rol «{role}».", { role: t(COLUMN_ROLE_LABEL.NEXT_RELEASE) })}
        </div>
      ) : (
        <ReleasesList
          query={q}
          resultCount={q ? releases.length : null}
          moreHref={hasMore && limit < LIST_MAX ? `?limit=${Math.min(limit + PAGE_STEP, LIST_MAX)}` : null}
          olderHidden={hasMore && limit >= LIST_MAX}
          searchTruncated={searchTruncated}
          releases={releases.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            deployedAt: r.deployedAt.toISOString(),
            author: r.createdBy?.name ?? null,
            taskCount: taskCount.get(r.id) ?? 0,
            attachments: r.attachments.map((a) => a.fileName),
          }))}
        />
      )}
    </div>
  );
}
