import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { activeUsers } from "@/lib/presence";
import { getCurrentUser } from "@/lib/session";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Otras personas con actividad en el tablero en los últimos 5 minutos. No se registra en los logs. */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response("No encontrado", { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response("No encontrado", { status: 404 });
  const users = activeUsers(project.id).filter((u) => u.id !== user.id).map(({ id, name }) => ({ id, name }));
  return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
