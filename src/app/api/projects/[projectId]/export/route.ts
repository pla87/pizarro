import { findManageableProject } from "@/lib/access";
import { actionContext } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { estimateProjectExport } from "@/lib/project-export/export";
import { EXPORT_SCOPES, type ExportOptions } from "@/lib/project-export/types";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { createExportJob } from "@/lib/transfer-jobs";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `attachments` («with» o «without») y `scope` («board» o «all»); null si no son válidos. */
function parseOptions(attachments: unknown, scope: unknown): ExportOptions | null {
  if ((attachments !== "with" && attachments !== "without") || typeof scope !== "string" || !(EXPORT_SCOPES as readonly string[]).includes(scope)) return null;
  return { attachments: attachments === "with", scope: scope as ExportOptions["scope"] };
}

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * `?attachments=with|without&scope=board|all&estimate=1`: recuentos previos de lo que se exportaría (JSON). La descarga del
 * archivo ya no sale de aquí: es un trabajo en segundo plano (POST de esta ruta) que se baja desde /api/transfer-jobs/<id>/download.
 */
export async function GET(req: Request, ctx: Ctx) {
  return actionContext.run({}, () => handle(req, ctx, "estimate"));
}

/** Pone en cola la exportación del proyecto (solo quienes lo gestionan). Cuerpo JSON `{attachments, scope}`; responde enseguida con `{jobId}`. */
export async function POST(req: Request, ctx: Ctx) {
  return actionContext.run({}, () => handle(req, ctx, "create"));
}

async function handle(req: Request, ctx: Ctx, mode: "estimate" | "create") {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
  if (mode === "create") {
    if (!isSameOrigin(req)) return Response.json({ error: t("Origen no permitido.") }, { status: 403 });
  } else {
    // Una petición de lectura puede no llevar Origin; sí lleva Sec-Fetch-Site. Se rechaza lo que viene de otro sitio.
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return Response.json({ error: t("Origen no permitido.") }, { status: 403 });
  }
  let options: ExportOptions | null;
  if (mode === "create") {
    const body = (await req.json().catch(() => null)) as { attachments?: unknown; scope?: unknown } | null;
    options = parseOptions(body?.attachments, body?.scope);
  } else {
    const sp = new URL(req.url).searchParams;
    options = sp.get("estimate") === "1" ? parseOptions(sp.get("attachments"), sp.get("scope")) : null;
  }
  if (!options) return Response.json({ error: t("Datos no válidos") }, { status: 400 });
  const { projectId } = await ctx.params;
  const ip = clientIp(req.headers);
  try {
    // Los recuentos son baratos; encolar una exportación, no: tope bajo por persona.
    if (!rateLimit(mode === "estimate" ? `project-export-estimate:${user.id}` : `project-export:${user.id}`, mode === "estimate" ? 120 : 6, mode === "estimate" ? 60_000 : 10 * 60_000)) {
      throw new AppError("Demasiadas peticiones", 429);
    }
    const project = await findManageableProject(user, projectId);
    if (mode === "estimate") return Response.json(await estimateProjectExport(project.id, options), { headers: { "Cache-Control": "private, no-store" } });
    const job = await createExportJob(user.id, project.id, options);
    logEvent({
      category: "api", action: "projects.exportQueued", message: `Exportación del proyecto «${project.name}» en cola`,
      userId: user.id, userName: user.name, projectId: project.id, path: `/api/projects/${project.id}/export`, ip, details: { jobId: job.id, options },
    });
    return Response.json({ ok: true, jobId: job.id }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) {
      logEvent({ level: "warn", category: "api", action: "projects.exportFailed", message: `Exportación rechazada: ${err.message}`, userId: user.id, userName: user.name, path: `/api/projects/${projectId}/export`, ip, details: { status: err.status } });
      return Response.json({ error: t(err.message), ...(err.code ? { code: err.code } : {}) }, { status: err.status });
    }
    console.error("[project export]", err);
    logEvent({ level: "error", category: "api", action: "projects.exportFailed", message: `Fallo al exportar: ${err instanceof Error ? err.message : String(err)}`, userId: user.id, userName: user.name, path: `/api/projects/${projectId}/export`, ip });
    return Response.json({ error: t("No se pudo exportar el proyecto.") }, { status: 500 });
  }
}
