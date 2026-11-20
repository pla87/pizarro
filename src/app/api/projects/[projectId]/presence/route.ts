import { canAccessProject } from "@/lib/access-cache";
import { activeUsers, notePresence, openTaskViewers } from "@/lib/presence";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import * as v from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Personas (incluido el usuario actual) con actividad en el tablero en los últimos 5 minutos y, por tarea, las demás
 * personas que la tienen abierta ahora (círculos de las tarjetas). No se registra en los logs.
 *
 * Tener el tablero a la vista también cuenta como actividad: el tablero solo pregunta con la pestaña visible (cada 60 s y
 * al volver a ella), así que una pestaña olvidada en segundo plano deja de contar a los 5 minutos.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  // El idioma (otra lectura de la sesión) solo hace falta para los mensajes de error.
  const user = await getCurrentUser();
  if (!user) return new Response((await getT())("No autorizado"), { status: 401 });
  const parsed = v.id.safeParse((await ctx.params).projectId);
  if (!parsed.success) return new Response((await getT())("No encontrado"), { status: 404 });
  // Acceso con caché breve (se consulta cada 60 s por pestaña); la sesión sí se comprueba siempre.
  if (!(await canAccessProject(user, parsed.data))) return new Response((await getT())("No encontrado"), { status: 404 });
  const project = { id: parsed.data };
  notePresence(project.id, user.id, user.name);
  const users = activeUsers(project.id).map(({ id, name }) => ({ id, name }));
  // Tareas abiertas por otras personas, solo las de este proyecto (cada aviso se anotó con el proyecto de su tarea, ya
  // comprobado: se filtra en memoria, sin consulta).
  const taskViewers = Object.fromEntries(openTaskViewers(project.id, user.id));
  return Response.json({ users, viewers: taskViewers }, { headers: { "Cache-Control": "no-store" } });
}
