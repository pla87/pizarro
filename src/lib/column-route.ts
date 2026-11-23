import "server-only";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import { rateLimit } from "./rate-limit";
import { isRowId } from "./row-id";
import { getCurrentUser } from "./session";
import { getT } from "../i18n/server";
import { toLocale, type Locale, type T } from "../i18n/core";

// Comprobaciones comunes de las rutas de descarga de una columna (PDF de la semana, lista, entrega, .ics):
// sesión, límite de peticiones y acceso al proyecto. Devuelve la respuesta de error o el contexto.

/** Descargas de una columna. Cada una con su propio contador: descargar varios .ics no agota los PDF, ni al revés. */
type ColumnDownloadKind = "week" | "checklist" | "delivery" | "program" | "ics";

/**
 * Peticiones por minuto de cada descarga: los PDF ocupan la cola de generación (5/min); el .ics de la Agenda es texto
 * barato y se descarga a menudo (30/min). El informe del proyecto lleva su propio contador (`project-report:`).
 */
const COLUMN_DOWNLOAD_LIMITS: Record<ColumnDownloadKind, number> = { week: 5, checklist: 5, delivery: 5, program: 5, ics: 30 };

export const columnRateKey = (kind: ColumnDownloadKind, userId: string) => `column-${kind}:${userId}`;

interface ColumnRouteContext {
  user: { id: string; name: string; role: string };
  t: T;
  locale: Locale;
  project: { id: string; name: string };
  projectId: string;
  columnId: string;
}

export async function authorizeColumnRoute(params: Promise<{ projectId: string; columnId: string }>, kind: ColumnDownloadKind): Promise<ColumnRouteContext | Response> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(columnRateKey(kind, user.id), COLUMN_DOWNLOAD_LIMITS[kind], 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  // Además, un tope común a todos los PDF de columna: cada tipo tiene el suyo, pero juntos no pasan de 10 por minuto.
  if (kind !== "ics" && !rateLimit(`column-pdf:${user.id}`, 10, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
  const { projectId, columnId } = await params;
  // Un id mal formado (el carácter nulo, p. ej.) no existe: 404 sin llegar a PostgreSQL, que fallaba con un 500.
  if (!isRowId(projectId) || !isRowId(columnId)) return new Response(t("No encontrado"), { status: 404 });
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
