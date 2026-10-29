import "server-only";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import { rateLimit } from "./rate-limit";
import { getCurrentUser } from "./session";
import { getT } from "../i18n/server";
import { toLocale, type Locale, type T } from "../i18n/core";

// Comprobaciones comunes de las rutas de descarga de una columna (PDF de la semana, lista, entrega, .ics):
// sesión, límite de peticiones y acceso al proyecto. Devuelve la respuesta de error o el contexto.

export interface ColumnRouteContext {
  user: { id: string; name: string };
  t: T;
  locale: Locale;
  project: { id: string; name: string };
  projectId: string;
  columnId: string;
}

export async function authorizeColumnRoute(params: Promise<{ projectId: string; columnId: string }>): Promise<ColumnRouteContext | Response> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(`report:${user.id}`, 5, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  const { projectId, columnId } = await params;
  const project = await db.project.findFirst({ where: { id: projectId, ...visibleProjectsWhere(user) }, select: { id: true, name: true } });
  if (!project) return new Response(t("No encontrado"), { status: 404 });
  return { user, t, locale: toLocale(user.locale), project, projectId, columnId };
}

export function pdfResponse(pdf: Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
