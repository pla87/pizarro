import { authorizeColumnRoute } from "@/lib/column-route";
import { saveGeneratedDocument, type GeneratedDocumentProblem } from "@/lib/documents";
import { generateProgramPdf, isPdfQueueError, nextProgramVersion } from "@/lib/report-build";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { publishChange } from "@/lib/realtime";
import { quotaError } from "@/lib/quota-message";
import { clientIp, isSameOrigin } from "@/lib/request";
import { intlLocale, type T } from "@/i18n/core";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";

type Params = Promise<{ projectId: string; columnId: string }>;

/** Por qué no se guardó el programa en la Documentación (mismos mensajes que al subir un documento). */
function problemMessage(problem: GeneratedDocumentProblem, t: T, ctx: { projectId: string; isAdmin: boolean; locale: string }): string {
  if (problem.reason === "size") return t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: problem.maxMb });
  if (problem.reason === "count") return t("La documentación del proyecto ya tiene el máximo de {n} archivos.", { n: problem.limit });
  return quotaError(t, problem.quota, ctx).message;
}

/**
 * «Publicar programa (PDF)» de una columna con rol «Programa»: GET lo muestra (`?assignee=1` incluye el responsable de
 * cada sesión); POST lo devuelve para descargar y, con `?save=1`, guarda además una copia en la Documentación del
 * proyecto («Programa – fecha_vN.pdf», con la versión siguiente del programa del proyecto) si cabe. El resultado del
 * guardado va en las cabeceras `X-Pizarro-Document-*` (`-Version`: N). Como mucho PROGRAM_MAX_SESSIONS sesiones: si la
 * columna tiene más, `X-Pizarro-Program-Omitted` dice cuántas se han quedado fuera.
 */
async function handle(req: Request, params: Params, method: "GET" | "POST") {
  const start = performance.now();
  if (method === "POST" && !isSameOrigin(req)) return new Response((await getT())("Origen no permitido."), { status: 403 });
  const auth = await authorizeColumnRoute(params);
  if (auth instanceof Response) return auth;
  const { user, t, locale, projectId, columnId, project } = auth;
  const url = new URL(req.url);
  const withAssignee = url.searchParams.get("assignee") === "1";
  const save = method === "POST" && url.searchParams.get("save") === "1";
  const path = `/api/projects/${projectId}/columns/${columnId}/program`;
  const report = await generateProgramPdf(projectId, columnId, { locale, withAssignee }).catch((err) => { if (isPdfQueueError(err)) return err; throw err; });
  if (report instanceof AppError) return new Response(t(report.message), { status: report.status });
  if (!report) return new Response(t("No encontrado"), { status: 404 });
  logEvent({
    category: "api", action: "report.pdf", message: `Programa PDF generado de «${project.name}» (${Math.round(report.pdf.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path, ip: clientIp(req.headers), durationMs: performance.now() - start,
    details: { tasks: report.taskCount, bytes: report.pdf.length, withAssignee, ...(report.omitted ? { omitted: report.omitted } : {}) },
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${method === "POST" ? "attachment" : "inline"}; filename="${report.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (report.omitted) headers["X-Pizarro-Program-Omitted"] = String(report.omitted);
  if (save) {
    // El acceso al proyecto ya lo comprobó authorizeColumnRoute (las mismas reglas que para subir documentos).
    // La versión se reserva al dar de alta el documento (en su transacción): si no cabe, no se gasta ningún número.
    let version = 0;
    const name = async (tx: Parameters<typeof nextProgramVersion>[0]) => report.documentName((version = await nextProgramVersion(tx, projectId)));
    const saved = await saveGeneratedDocument({ projectId, name, content: report.pdf, mimeType: "application/pdf", kind: "PDF", createdById: user.id })
      .catch((err) => ({ ok: false as const, error: err instanceof AppError ? t(err.message) : t("No se pudo guardar en la Documentación.") }));
    if (saved.ok) {
      headers["X-Pizarro-Document-Id"] = saved.document.id;
      headers["X-Pizarro-Document-Name"] = encodeURIComponent(saved.document.name);
      headers["X-Pizarro-Document-Version"] = String(version);
      logEvent({
        category: "api", action: "documents.upload", message: `Documento «${saved.document.name}» guardado desde «Publicar programa» (${Math.round(report.pdf.length / 1024)} KB)`,
        userId: user.id, userName: user.name, projectId, path, ip: clientIp(req.headers),
        details: { projectId, documentId: saved.document.id, storedBytes: report.pdf.length, kind: "PDF", source: "program", version },
      });
      publishChange({ projectId, userId: user.id, action: "documents.upload" });
    } else {
      const message = "problem" in saved ? problemMessage(saved.problem, t, { projectId, isAdmin: user.role === "ADMIN", locale: intlLocale(locale) }) : saved.error;
      headers["X-Pizarro-Document-Error"] = encodeURIComponent(message);
      logEvent({
        level: "warn", category: "api", action: "documents.uploadFailed", message: `No se guardó el programa en la Documentación: ${message}`,
        userId: user.id, userName: user.name, projectId, path, ip: clientIp(req.headers), details: { projectId, bytes: report.pdf.length, source: "program" },
      });
    }
  }
  return new Response(new Uint8Array(report.pdf), { headers });
}

export async function GET(req: Request, ctx: { params: Params }) {
  return handle(req, ctx.params, "GET");
}

export async function POST(req: Request, ctx: { params: Params }) {
  return handle(req, ctx.params, "POST");
}
