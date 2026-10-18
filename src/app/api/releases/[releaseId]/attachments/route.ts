import { readFile } from "node:fs/promises";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { releaseZipName } from "@/lib/release";
import { getCurrentUser } from "@/lib/session";
import { releaseAttachmentPath } from "@/lib/uploads";
import { buildZip } from "@/lib/zip";

export const runtime = "nodejs";

/** ZIP con las copias compactas de los adjuntos guardadas al desplegar una release. */
export async function GET(_req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { releaseId } = await ctx.params;
  const release = await db.release.findFirst({
    where: { id: releaseId, project: visibleProjectsWhere(user) },
    select: { title: true, attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true } } },
  });
  if (!release) return new Response("No encontrado", { status: 404 });

  const files: { name: string; data: Uint8Array }[] = [];
  for (const a of release.attachments) {
    try {
      files.push({ name: a.fileName, data: await readFile(releaseAttachmentPath(a.id)) });
    } catch {
      // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
    }
  }
  if (files.length === 0) return new Response("No hay adjuntos disponibles", { status: 404 });

  const name = releaseZipName(release.title);
  return new Response(new Uint8Array(buildZip(files)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
