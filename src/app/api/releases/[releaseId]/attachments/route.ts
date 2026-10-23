import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { releaseZipName, zipTooLarge } from "@/lib/release";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { readReleaseAttachmentFile } from "@/lib/uploads";
import { buildZip } from "@/lib/zip";

export const runtime = "nodejs";

/** ZIP con las copias compactas de los adjuntos guardadas al desplegar una release. */
export async function GET(req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const t = await getT();
  const start = performance.now();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (!rateLimit(`release-zip:${user.id}`, 10, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });

  const { releaseId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(releaseId)) return new Response(t("No encontrado"), { status: 404 });
  const release = await db.release.findFirst({
    where: { id: releaseId, project: visibleProjectsWhere(user) },
    select: { title: true, projectId: true, project: { select: { releaseZipMaxMb: true } }, attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true } } },
  });
  if (!release) return new Response(t("No encontrado"), { status: 404 });

  // Tope del proyecto (su valor actual), que se arma en memoria.
  const maxMb = release.project.releaseZipMaxMb;
  const files: { name: string; data: Uint8Array }[] = [];
  let total = 0;
  for (const a of release.attachments) {
    try {
      const data = await readReleaseAttachmentFile(a.id);
      total += data.length;
      if (total > maxMb * 1024 * 1024) return new Response(zipTooLarge(t, maxMb), { status: 413 });
      files.push({ name: a.fileName, data });
    } catch {
      // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
    }
  }
  if (files.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });

  const name = releaseZipName(release.title);
  const zip = buildZip(files);
  logEvent({
    category: "api", action: "release.zipDownload", message: `ZIP de adjuntos de la release «${release.title}» (${files.length} ficheros, ${Math.round(zip.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId: release.projectId, path: `/api/releases/${releaseId}/attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { releaseId, files: files.length, bytes: zip.length },
  });
  return new Response(new Uint8Array(zip.buffer as ArrayBuffer, zip.byteOffset, zip.length), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
