import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { leaveTask, noteTaskViewer } from "@/lib/presence";
import { isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(ctx: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const parsed = v.id.safeParse((await ctx.params).taskId);
  if (!parsed.success) return null;
  const task = await db.task.findFirst({ where: { id: parsed.data, project: visibleProjectsWhere(user) }, select: { id: true } });
  return task ? { user, taskId: task.id } : null;
}

/** El diálogo de la tarea avisa de que sigue abierto y recibe quién más la tiene abierta. No se registra en los logs. */
export async function GET(_req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const t = await getT();
  const found = await load(ctx);
  if (!found) return new Response(t("No encontrado"), { status: 404 });
  const others = noteTaskViewer(found.taskId, found.user.id, found.user.name);
  return Response.json({ others }, { headers: { "Cache-Control": "no-store" } });
}

/** El diálogo se ha cerrado. */
export async function DELETE(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  // Modifica estado (la presencia): misma comprobación de origen que el resto de rutas que escriben.
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const found = await load(ctx);
  if (found) leaveTask(found.taskId, found.user.id);
  return new Response(null, { status: 204 });
}
