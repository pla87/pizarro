import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { releaseZipName } from "@/lib/release";
import { buildZipPart, planZipEntries, zipPlanBody, zipRequestMode, type ZipEntry } from "@/lib/release-zip";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { readReleaseAttachmentFile, releaseAttachmentFileSize } from "@/lib/uploads";

export const runtime = "nodejs";

/** ZIP con las copias compactas de los adjuntos guardadas al desplegar una release. */
export async function GET(req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const t = await getT();
  const start = performance.now();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const mode = zipRequestMode(req.url);
  if (!mode) return new Response(t("Datos no válidos"), { status: 400 });
  // El plan (o la petición sin paquete) cuenta como la descarga; cada paquete pedido por número tiene su propio tope.
  const allowed = mode.kind === "part" && mode.explicit ? rateLimit(`release-zip-part:${user.id}`, 120, 60_000) : rateLimit(`release-zip:${user.id}`, 10, 60_000);
  if (!allowed) return new Response(t("Demasiadas peticiones"), { status: 429 });

  const { releaseId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(releaseId)) return new Response(t("No encontrado"), { status: 404 });
  const release = await db.release.findFirst({
    where: { id: releaseId, project: visibleProjectsWhere(user) },
    select: { title: true, projectId: true, project: { select: { releaseZipMaxMb: true } }, attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true } } },
  });
  if (!release) return new Response(t("No encontrado"), { status: 404 });

  // Tope del proyecto (su valor actual): cada paquete se arma en memoria hasta ese tamaño.
  const maxMb = release.project.releaseZipMaxMb;
  const entries: ZipEntry[] = [];
  for (const a of release.attachments) {
    const size = await releaseAttachmentFileSize(a.id);
    // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
    if (size !== null) entries.push({ name: a.fileName, size, read: () => readReleaseAttachmentFile(a.id) });
  }
  if (entries.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  const packages = planZipEntries(entries, maxMb);
  if (mode.kind === "plan") return Response.json(zipPlanBody(packages, maxMb), { headers: { "Cache-Control": "private, no-store" } });
  const pkg = packages[mode.part - 1];
  if (!pkg) return new Response(t("No encontrado"), { status: 404 });
  const { zip, files: fileCount } = await buildZipPart(entries, pkg);
  if (fileCount === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });

  const name = releaseZipName(release.title, mode.part, packages.length);
  logEvent({
    category: "api", action: "release.zipDownload", message: `ZIP de adjuntos de la release «${release.title}» (paquete ${mode.part}/${packages.length}, ${fileCount} ficheros, ${Math.round(zip.length / 1024)} KB)`,
    userId: user.id, userName: user.name, projectId: release.projectId, path: `/api/releases/${releaseId}/attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { releaseId, part: mode.part, parts: packages.length, files: fileCount, bytes: zip.length },
  });
  return new Response(new Uint8Array(zip.buffer as ArrayBuffer, zip.byteOffset, zip.length), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Zip-Parts": String(packages.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
