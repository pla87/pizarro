import { Readable } from "node:stream";
import { findManageableProject } from "@/lib/access";
import { actionContext } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { buildProjectExport, estimateProjectExport } from "@/lib/project-export/export";
import { EXPORT_SCOPES, type ExportOptions } from "@/lib/project-export/types";
import { acquireZipSlot } from "@/lib/release-zip";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { streamZip } from "@/lib/zip-stream";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `?attachments=with|without&scope=board|all`; con `&estimate=1` solo devuelve los recuentos (JSON). */
function parseOptions(url: string): (ExportOptions & { estimate: boolean }) | null {
  const sp = new URL(url).searchParams;
  const attachments = sp.get("attachments");
  const scope = sp.get("scope");
  if ((attachments !== "with" && attachments !== "without") || !(EXPORT_SCOPES as readonly string[]).includes(scope ?? "")) return null;
  return { attachments: attachments === "with", scope: scope as ExportOptions["scope"], estimate: sp.get("estimate") === "1" };
}

/** Descarga del proyecto entero como .pizarro.zip (solo quienes gestionan el proyecto). Se emite en flujo, sin juntarlo en memoria. */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return actionContext.run({}, () => handleGet(req, ctx));
}

async function handleGet(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const start = performance.now();
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
  // Una descarga por navegación no lleva Origin; sí lleva Sec-Fetch-Site. Se rechaza lo que viene de otro sitio.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return Response.json({ error: t("Origen no permitido.") }, { status: 403 });
  const options = parseOptions(req.url);
  if (!options) return Response.json({ error: t("Datos no válidos") }, { status: 400 });
  const { projectId } = await ctx.params;
  const ip = clientIp(req.headers);
  let releaseSlot: (() => void) | null = null;
  try {
    // Los recuentos son baratos; la exportación entera, no: tope bajo por persona.
    if (!rateLimit(options.estimate ? `project-export-estimate:${user.id}` : `project-export:${user.id}`, options.estimate ? 120 : 6, options.estimate ? 60_000 : 10 * 60_000)) {
      throw new AppError("Demasiadas peticiones", 429);
    }
    const project = await findManageableProject(user, projectId);
    if (options.estimate) return Response.json(await estimateProjectExport(project.id, options), { headers: { "Cache-Control": "private, no-store" } });

    // Una por persona y pocas en todo el servidor, como las descargas ZIP de releases.
    releaseSlot = acquireZipSlot(user.id);
    if (!releaseSlot) throw new AppError("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos.", 429);
    const release = releaseSlot;
    const built = await buildProjectExport(project.id, options);

    async function* body() {
      let ok = false;
      try {
        yield* streamZip(built.entries);
        ok = true;
      } finally {
        release();
        logEvent({
          level: ok ? "info" : "warn", category: "api", action: ok ? "projects.export" : "projects.exportFailed",
          message: ok
            ? `Proyecto «${project.name}» exportado (${built.manifest.counts.tasks} tareas, ${Math.round(built.size / 1024)} KB)`
            : `La exportación del proyecto «${project.name}» se interrumpió`,
          userId: user!.id, userName: user!.name, projectId: project.id, path: `/api/projects/${project.id}/export`, ip, durationMs: performance.now() - start,
          details: { options: built.manifest.options, counts: built.manifest.counts, bytes: built.size, missingFiles: built.missingFiles },
        });
      }
    }
    releaseSlot = null; // desde aquí lo libera el flujo
    const readable = Readable.from(body(), { objectMode: false });
    // Un generador que no llegó a arrancar no ejecuta su «finally»: el hueco se libera también al cerrarse el flujo.
    readable.on("close", release);
    return new Response(Readable.toWeb(readable) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(built.size),
        "Content-Disposition": `attachment; filename="${built.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(built.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    releaseSlot?.();
    if (err instanceof AppError) {
      logEvent({ level: "warn", category: "api", action: "projects.exportFailed", message: `Exportación rechazada: ${err.message}`, userId: user.id, userName: user.name, path: `/api/projects/${projectId}/export`, ip, details: { status: err.status } });
      return Response.json({ error: t(err.message) }, { status: err.status });
    }
    console.error("[project export]", err);
    logEvent({ level: "error", category: "api", action: "projects.exportFailed", message: `Fallo al exportar: ${err instanceof Error ? err.message : String(err)}`, userId: user.id, userName: user.name, path: `/api/projects/${projectId}/export`, ip });
    return Response.json({ error: t("No se pudo exportar el proyecto.") }, { status: 500 });
  }
}
