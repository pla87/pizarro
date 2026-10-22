import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { activeUsers, openTaskViewers } from "@/lib/presence";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Personas (incluido el usuario actual) con actividad en el tablero en los últimos 5 minutos y, por tarea, las demás
 * personas que la tienen abierta ahora (círculos de las tarjetas). No se registra en los logs.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });
  const users = activeUsers(project.id).map(({ id, name }) => ({ id, name }));
  // Tareas abiertas por otras personas, solo las de este proyecto (una consulta, y solo si hay alguna).
  const open = openTaskViewers(user.id);
  const taskViewers: Record<string, { id: string; name: string }[]> = {};
  if (open.size > 0) {
    const tasks = await db.task.findMany({ where: { id: { in: [...open.keys()] }, projectId: project.id }, select: { id: true } });
    for (const task of tasks) taskViewers[task.id] = open.get(task.id)!;
  }
  return Response.json({ users, viewers: taskViewers }, { headers: { "Cache-Control": "no-store" } });
}
