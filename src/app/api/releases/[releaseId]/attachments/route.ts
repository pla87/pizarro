import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { appTimeZone } from "@/lib/format";
import { isoDate, releaseZipName } from "@/lib/release";
import { acquireZipSlot, planZipEntries, prepareZipPart, sizedZipEntries, zipHeadResponse, zipPartBody, zipPlanBody, zipRateKey, zipRequestMode, zipSlotBusy, zipVersionConflict, zipPartRequired } from "@/lib/release-zip";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";
import { getCurrentUser } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { releaseAttachmentFileSize, releaseAttachmentStream } from "@/lib/uploads";
import { logSize } from "@/lib/format-size";

export const runtime = "nodejs";

/** HEAD no se sirve: derivado de GET, reservaba el hueco del ZIP y leía los ficheros (ver zipHeadResponse). */
export const HEAD = () => zipHeadResponse("GET");

/** ZIP con las copias compactas de los adjuntos guardadas al desplegar una release. */
export async function GET(req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const t = await getT();
  const start = performance.now();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const mode = zipRequestMode(req.url);
  if (!mode) return new Response(t("Datos no válidos"), { status: 400 });
  if (mode.kind === "incomplete") return zipPartRequired(t);
  // El plan cuenta como la descarga; cada paquete tiene su propio tope.
  const rate = zipRateKey(mode, user.id);
  const allowed = rateLimit(rate.key, rate.limit, 60_000);
  if (!allowed) return new Response(t("Demasiadas peticiones"), { status: 429 });

  const { releaseId } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(releaseId)) return new Response(t("No encontrado"), { status: 404 });
  const release = await db.release.findFirst({
    where: { id: releaseId, project: visibleProjectsWhere(user) },
    select: { title: true, number: true, deployedAt: true, projectId: true, project: { select: { name: true, releaseZipMaxMb: true } }, attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true } } },
  });
  if (!release) return new Response(t("No encontrado"), { status: 404 });

  // Tope del proyecto (su valor actual): cada paquete pesa como mucho ese tamaño.
  const maxMb = release.project.releaseZipMaxMb;
  // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
  const entries = await sizedZipEntries(
    release.attachments.map((a) => ({ id: a.id, name: a.fileName, open: () => releaseAttachmentStream(a.id) })),
    (c) => releaseAttachmentFileSize(c.id),
  );
  if (entries.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  const packages = planZipEntries(entries, maxMb);
  // `busy`: la página avisa antes de lanzar la descarga directa si ahora tocaría «Ya se está preparando otro ZIP».
  if (mode.kind === "plan") return Response.json({ ...zipPlanBody(packages, maxMb, entries), busy: zipSlotBusy(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
  const conflict = zipVersionConflict(mode, entries, maxMb, t("Los adjuntos han cambiado mientras se descargaban. Vuelve a descargarlos."));
  if (conflict) return conflict;
  const pkg = packages[mode.part - 1];
  if (!pkg) return new Response(t("No encontrado"), { status: 404 });
  // Uno a la vez por persona y pocos en todo el servidor (cada paquete se lee dos veces del disco y se envía en flujo).
  const releaseSlot = acquireZipSlot(user.id);
  if (!releaseSlot) return new Response(t("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos."), { status: 429, headers: { "Retry-After": "5" } });
  // El hueco se suelta cuando se ha enviado el ZIP entero (o se cancela la descarga), no al terminar de prepararlo.
  // Primera pasada en flujo: tamaño y CRC de cada fichero; el ZIP no se junta en memoria.
  let zipPart: Awaited<ReturnType<typeof prepareZipPart>>;
  try {
    zipPart = await prepareZipPart(entries, pkg, req.signal);
  } catch (err) {
    releaseSlot();
    throw err;
  }
  const fileCount = zipPart.entries.length;
  if (fileCount === 0) {
    releaseSlot();
    return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  }

  // El mismo nombre que da la página (y el diálogo de generarla): fecha, número y proyecto.
  const name = releaseZipName({ day: isoDate(release.deployedAt, appTimeZone()), number: release.number, project: release.project.name }, mode.part, packages.length, await getLocale());
  logEvent({
    category: "api", action: "release.zipDownload", message: `ZIP de adjuntos de la release «${release.title}» (paquete ${mode.part}/${packages.length}, ${fileCount} ficheros, ${logSize(zipPart.bytes)})`,
    userId: user.id, userName: user.name, projectId: release.projectId, path: `/api/releases/${releaseId}/attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { releaseId, part: mode.part, parts: packages.length, files: fileCount, bytes: zipPart.bytes },
  });
  return new Response(zipPartBody(zipPart, releaseSlot, { signal: req.signal }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipPart.bytes),
      // Next quita el Content-Length; con este vuelve a salir y el navegador enseña el progreso (lib/response-length.ts).
      [DECLARED_LENGTH_HEADER]: String(zipPart.bytes),
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Zip-Parts": String(packages.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
