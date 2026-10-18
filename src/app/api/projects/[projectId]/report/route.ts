import { visibleProjectsWhere } from "@/lib/access";
import { appTimeZone } from "@/lib/board";
import { dateToIso, todayIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { buildReport } from "@/lib/report";
import { renderReportPdf } from "@/lib/report-pdf";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

/** Informe PDF del estado del proyecto (columnas, entregables, plazos, personas y releases). */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (!rateLimit(`report:${user.id}`, 20, 60_000)) return new Response("Demasiadas peticiones", { status: 429 });
  const { projectId } = await ctx.params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true, description: true },
  });
  if (!project) return new Response("No encontrado", { status: 404 });

  const [columns, tasks, deliverables, releases, archivedCount] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } }),
    db.task.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { position: "asc" },
      take: 2000,
      select: {
        id: true,
        title: true,
        type: true,
        columnId: true,
        dueDate: true,
        deliverableId: true,
        assignee: { select: { name: true } },
        subtasks: { select: { done: true } },
      },
    }),
    db.deliverable.findMany({ where: { projectId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }], select: { id: true, name: true, description: true, dueDate: true } }),
    db.release.findMany({ where: { projectId }, orderBy: { deployedAt: "desc" }, take: 5, select: { title: true, deployedAt: true, _count: { select: { tasks: true } } } }),
    db.task.count({ where: { projectId, archivedAt: { not: null } } }),
  ]);

  const today = todayIso(appTimeZone());
  const report = buildReport({
    project: { name: project.name, description: project.description },
    generatedBy: user.name,
    today,
    columns,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      columnId: t.columnId,
      assigneeName: t.assignee?.name ?? null,
      dueDate: dateToIso(t.dueDate),
      deliverableId: t.deliverableId,
      subtaskTotal: t.subtasks.length,
      subtaskDone: t.subtasks.filter((x) => x.done).length,
    })),
    deliverables: deliverables.map((d) => ({ ...d, dueDate: dateToIso(d.dueDate) })),
    releases: releases.map((r) => ({ title: r.title, deployedAt: r.deployedAt.toISOString(), taskCount: r._count.tasks })),
    archivedCount,
  });

  const pdf = await renderReportPdf(report);
  const slug = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "proyecto";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="informe-${slug}-${today}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
