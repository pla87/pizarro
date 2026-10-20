import { notFound } from "next/navigation";
import { Rocket } from "lucide-react";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { ReleasesList } from "./ReleasesList";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Releases") };
}

const PAGE_STEP = 50;

const ACCENTS = "áàäâãéèëêíìïîóòöôõúùüûñç";
const PLAIN = "aaaaaeeeeiiiiooooouuuunc";
const unaccent = (text: string) => text.replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => PLAIN[ACCENTS.indexOf(c)]!);

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
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 200) ?? "";
  const rawLimit = Number(Array.isArray(sp.limit) ? sp.limit[0] : sp.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= PAGE_STEP ? Math.min(Math.floor(rawLimit), 100000) : PAGE_STEP;
  // Con búsqueda se recorre TODO el histórico del proyecto (sin límite); sin ella, las últimas `limit`.
  // Sin distinguir mayúsculas ni tildes: se comparan ambos lados en minúsculas y sin acentos.
  let where: { id?: { in: string[] } } = {};
  if (q) {
    const needle = `%${unaccent(q.toLowerCase()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Release" WHERE "projectId" = ${projectId}
        AND (translate(lower("title"), ${ACCENTS}, ${PLAIN}) LIKE ${needle} OR translate(lower("content"), ${ACCENTS}, ${PLAIN}) LIKE ${needle})`;
    where = { id: { in: rows.map((r) => r.id) } };
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
          content: true,
          deployedAt: true,
          createdBy: { select: { name: true } },
          _count: { select: { tasks: true } },
          attachments: { orderBy: { position: "asc" }, select: { fileName: true } },
        },
      },
    },
  });
  if (!project) notFound();
  const hasMore = !q && project.releases.length > limit;
  const releases = hasMore ? project.releases.slice(0, limit) : project.releases;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold">{t("Releases")}</h1>
      <p className="mb-6 text-sm text-slate-500">{t("Histórico de despliegues de «{name}» con el texto final editado.", { name: project.name })}</p>
      {project._count.releases === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
          <Rocket size={32} className="text-slate-300" />
          {t("Aún no hay releases. Genera una desde la columna «Siguiente salto a producción» del tablero.")}
        </div>
      ) : (
        <ReleasesList
          query={q}
          resultCount={q ? releases.length : null}
          moreHref={hasMore ? `?limit=${limit + PAGE_STEP}` : null}
          releases={releases.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            content: r.content,
            deployedAt: r.deployedAt.toISOString(),
            author: r.createdBy?.name ?? null,
            taskCount: r._count.tasks,
            attachments: r.attachments.map((a) => a.fileName),
          }))}
        />
      )}
    </div>
  );
}
