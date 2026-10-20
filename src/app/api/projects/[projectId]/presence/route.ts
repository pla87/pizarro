import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { activeUsers } from "@/lib/presence";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Personas (incluido el usuario actual) con actividad en el tablero en los últimos 5 minutos. No se registra en los logs. */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response(t("No encontrado"), { status: 404 });
  const project = await db.project.findFirst({ where: { id: parsed.data, ...visibleProjectsWhere(user) }, select: { id: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });
  const users = activeUsers(project.id).map(({ id, name }) => ({ id, name }));
  return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
