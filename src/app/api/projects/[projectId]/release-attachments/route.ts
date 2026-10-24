import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { attachmentFileNames, isoDate } from "@/lib/release";
import { acquireZipSlot, buildZipPart, planZipEntries, zipPlanBody, zipRateKey, zipRequestMode, type ZipEntry } from "@/lib/release-zip";
import { partSuffix } from "@/lib/zip-plan";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { attachmentPath } from "@/lib/uploads";
import * as v from "@/lib/validation";

export const runtime = "nodejs";

const bodySchema = z.object({
  items: z
    .array(z.object({ taskId: v.id, code: z.string().regex(/^(R\d{1,5})?[A-Z]{1,4}\d{1,4}$/) }))
    .min(1)
    .max(200),
});

/**
 * ZIP con los adjuntos de las tareas de una release, renombrados `${código}_${nombre}.webp`.
 * Los nombres se recalculan aquí con el mismo helper que el texto de la release.
 */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const start = performance.now();
  if (!isSameOrigin(req)) return new Response(t("Origen no permitido"), { status: 403 });
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const mode = zipRequestMode(req.url);
  if (!mode) return new Response(t("Datos no válidos"), { status: 400 });
  // Una release pide un plan y luego cada paquete: el plan (o la petición sin paquete) cuenta como la descarga;
  // los paquetes tienen su propio tope, más holgado.
  const rate = zipRateKey(mode, user.id);
  const allowed = rateLimit(rate.key, rate.limit, 60_000);
  if (!allowed) return new Response(t("Demasiadas peticiones"), { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(t("Datos no válidos"), { status: 400 });
  const { items } = parsed.data;
  const ids = new Set(items.map((i) => i.taskId));
  const codes = new Set(items.map((i) => i.code));
  if (ids.size !== items.length || codes.size !== items.length) return new Response(t("Datos no válidos"), { status: 400 });

  const { projectId } = await ctx.params;
  const tasks = await db.task.findMany({
    where: { id: { in: [...ids] }, projectId, project: visibleProjectsWhere(user) },
    select: {
      id: true,
      attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, isImage: true } },
    },
  });
  // Todas las tareas deben existir en este proyecto y ser visibles.
  if (tasks.length !== ids.size) return new Response(t("No encontrado"), { status: 404 });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Cada paquete se arma en memoria hasta el tope del proyecto; si no cabe todo, salen varios.
  const { releaseZipMaxMb } = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { releaseZipMaxMb: true } });

  const entries: ZipEntry[] = [];
  for (const item of items) {
    const attachments = byId.get(item.taskId)!.attachments;
    const names = attachmentFileNames(item.code, attachments);
    for (const [i, a] of attachments.entries()) {
      const file = attachmentPath(a.id, a.isImage ? "full" : "file");
      const size = await stat(file).then((st) => st.size, () => null);
      // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
      if (size !== null) entries.push({ name: names[i]!, size, read: () => readFile(file) });
    }
  }
  if (entries.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  const packages = planZipEntries(entries, releaseZipMaxMb);
  if (mode.kind === "plan") return Response.json(zipPlanBody(packages, releaseZipMaxMb), { headers: { "Cache-Control": "private, no-store" } });
  const pkg = packages[mode.part - 1];
  if (!pkg) return new Response(t("No encontrado"), { status: 404 });
  // Uno a la vez por persona y pocos en todo el servidor (cada paquete se arma en memoria).
  const releaseSlot = acquireZipSlot(user.id);
  if (!releaseSlot) return new Response(t("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos."), { status: 429, headers: { "Retry-After": "5" } });
  let built: Awaited<ReturnType<typeof buildZipPart>>;
  try {
    built = await buildZipPart(entries, pkg);
  } finally {
    releaseSlot();
  }
  const { zip, files: fileCount } = built;
  if (fileCount === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  logEvent({
    category: "api", action: "release.zipDownload", message: `ZIP de adjuntos de release (paquete ${mode.part}/${packages.length}, ${fileCount} ficheros, ${Math.round(zip.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/release-attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { tasks: items.length, part: mode.part, parts: packages.length, files: fileCount, bytes: zip.length },
  });
  return new Response(new Uint8Array(zip.buffer as ArrayBuffer, zip.byteOffset, zip.length), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="release-${isoDate()}-adjuntos${partSuffix(mode.part, packages.length)}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Zip-Parts": String(packages.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
