import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findManageableProject } from "@/lib/access";
import { actionContext } from "@/lib/action-context";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { exportFileOf, getJobFor } from "@/lib/transfer-jobs";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Descarga del archivo de una exportación lista, en flujo y con Content-Length. Solo quien la pidió y mientras siga gestionando el proyecto (un administrador ve el estado, pero no se lleva el archivo de otra persona). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return actionContext.run({}, async () => {
    const t = await getT();
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: t("No autorizado") }, { status: 401 });
    // Una descarga por navegación no lleva Origin; sí lleva Sec-Fetch-Site. Se rechaza lo que viene de otro sitio.
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return Response.json({ error: t("Origen no permitido.") }, { status: 403 });
    try {
      const job = await getJobFor(user, (await ctx.params).id);
      if (job.kind !== "EXPORT") throw new AppError("No encontrado o sin acceso.", 404);
      if (job.userId !== user.id) throw new AppError("No encontrado o sin acceso.", 404);
      // Quien dejó de poder gestionar el proyecto (lo sacaron, lo hicieron privado, se borró…) ya no se lleva el archivo, tampoco un administrador.
      if (!job.projectId) throw new AppError("No encontrado o sin acceso.", 404);
      await findManageableProject(user, job.projectId);
      if (job.status === "EXPIRED" || (job.expiresAt && job.expiresAt.getTime() < Date.now())) throw new AppError("El archivo de esta exportación ha caducado. Vuelve a exportar el proyecto.", 410);
      const f = exportFileOf(job);
      if (!f) throw new AppError("La exportación todavía no está lista.", 409);
      const size = await stat(f.file).then((s) => s.size).catch(() => -1);
      if (size < 0) throw new AppError("El archivo de esta exportación ha caducado. Vuelve a exportar el proyecto.", 410);
      logEvent({ category: "api", action: "projects.exportDownload", message: `Descarga de la exportación «${f.name}»`, userId: user.id, userName: user.name, projectId: job.projectId ?? undefined, path: `/api/transfer-jobs/${job.id}/download`, ip: clientIp(req.headers), details: { jobId: job.id, bytes: size } });
      return new Response(Readable.toWeb(createReadStream(f.file)) as ReadableStream<Uint8Array>, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (err) {
      if (err instanceof AppError) return Response.json({ error: t(err.message) }, { status: err.status });
      throw err;
    }
  });
}
