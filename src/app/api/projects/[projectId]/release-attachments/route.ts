import { readFile } from "node:fs/promises";
import { z } from "zod";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { attachmentFileNames, isoDate } from "@/lib/release";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { attachmentPath } from "@/lib/uploads";
import * as v from "@/lib/validation";
import { buildZip } from "@/lib/zip";

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
  if (!rateLimit(`release-zip:${user.id}`, 10, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });

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

  const files: { name: string; data: Uint8Array }[] = [];
  for (const item of items) {
    const attachments = byId.get(item.taskId)!.attachments;
    const names = attachmentFileNames(item.code, attachments);
    for (const [i, a] of attachments.entries()) {
      try {
        files.push({ name: names[i]!, data: await readFile(attachmentPath(a.id, a.isImage ? "full" : "file")) });
      } catch {
        // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
      }
    }
  }
  if (files.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });

  const zip = buildZip(files);
  logEvent({
    category: "api", action: "release.zipDownload", message: `ZIP de adjuntos de release (${files.length} ficheros, ${Math.round(zip.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/release-attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { tasks: items.length, files: files.length, bytes: zip.length },
  });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="release-${isoDate()}-adjuntos.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
