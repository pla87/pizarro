import { appTimeZone } from "@/lib/format";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { AI_PLAN_ZIP_FOLDER, aiPlanZipRoot } from "@/lib/ai-plan";
import { aiPlanZipName, attachmentFileNames, isoDate, plainAttachmentFileNames, RELEASE_MAX_ATTACHMENT_TASKS, releaseZipName } from "@/lib/release";
import { acquireZipSlot, planZipEntries, prepareZipPart, sizedZipEntries, zipPartBody, zipPlanBody, zipRateKey, zipRequestMode, zipSlotBusy, zipVersionConflict, type ZipEntry } from "@/lib/release-zip";
import { findZipTicket, issueZipTicket } from "@/lib/zip-ticket";
import { clientIp, isSameOrigin } from "@/lib/request";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";
import { getCurrentUser } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { attachmentPath } from "@/lib/uploads";
import * as v from "@/lib/validation";
import { logSize } from "@/lib/format-size";

export const runtime = "nodejs";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        taskId: v.id,
        // Release: el código de la tarea (R32F1), que prefija los nombres. Plan de trabajo para IA: la carpeta de la tarea
        // dentro del ZIP («adjuntos/03-titulo», o «attachments/03-title» si el plan está en inglés). Cada elemento lleva uno de los dos.
        code: z.string().regex(/^(R\d{1,5})?[A-Z]{1,4}\d{1,4}$/).optional(),
        folder: z.string().regex(AI_PLAN_ZIP_FOLDER).optional(),
      }).refine((i) => (i.code === undefined) !== (i.folder === undefined)),
    )
    .min(1)
    .max(RELEASE_MAX_ATTACHMENT_TASKS),
});

type Items = z.infer<typeof bodySchema>["items"];
type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type Mode = NonNullable<ReturnType<typeof zipRequestMode>>;
type Ticket = NonNullable<ReturnType<typeof findZipTicket>>;

/** Nombre del fichero que pide la página (fecha, número o versión y proyecto); si no vale, el de serie. */
const ZIP_FILE_NAME = /^[^\u0000-\u001f\u007f/\\"]{1,200}\.zip$/;

/**
 * ZIP con los adjuntos de las tareas de una release, renombrados `${código}_${nombre}.webp`, o de un plan de trabajo
 * (carpetas `adjuntos/NN-titulo/`). Los nombres se recalculan aquí con el mismo helper que el texto.
 * `POST ?plan=1` con la lista de tareas devuelve el reparto en paquetes y un vale (`ticket`, `src/lib/zip-ticket.ts`);
 * cada paquete lo descarga el propio navegador con `GET ?ticket=…&part=N&v=…`. `POST ?part=N` sigue sirviendo el
 * paquete en la respuesta.
 */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  if (!isSameOrigin(req)) return new Response(t("Origen no permitido"), { status: 403 });
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const mode = zipRequestMode(req.url);
  if (!mode) return new Response(t("Datos no válidos"), { status: 400 });
  // Una release pide un plan y luego cada paquete: el plan (o la petición sin paquete) cuenta como la descarga;
  // los paquetes tienen su propio tope, más holgado.
  const rate = zipRateKey(mode, user.id);
  if (!rateLimit(rate.key, rate.limit, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(t("Datos no válidos"), { status: 400 });
  const { items } = parsed.data;
  const ids = new Set(items.map((i) => i.taskId));
  const codes = new Set(items.map((i) => i.code ?? i.folder));
  // Todas del mismo tipo: o es el ZIP de una release (códigos) o el de un plan (carpetas).
  const planZip = items[0]!.folder !== undefined;
  if (items.some((i) => (i.folder !== undefined) !== planZip)) return new Response(t("Datos no válidos"), { status: 400 });
  if (ids.size !== items.length || codes.size !== items.length) return new Response(t("Datos no válidos"), { status: 400 });
  // Un plan está en un solo idioma: todas sus carpetas cuelgan de la misma raíz («adjuntos/» o «attachments/»), no de las dos.
  if (planZip && new Set(items.map((i) => aiPlanZipRoot(i.folder!))).size !== 1) return new Response(t("Datos no válidos"), { status: 400 });
  const { projectId } = await ctx.params;
  return serveZip(req, t, user, projectId, items, mode, { issueTicket: mode.kind === "plan" });
}

/**
 * Con el vale del plan: un paquete en descarga directa (`?ticket=…&part=N&v=…&name=…`) o el estado del vale
 * (`?ticket=…&status=1`: paquetes empezados, terminados y fallidos), que la página consulta mientras descarga.
 */
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  const sp = new URL(req.url).searchParams;
  const { projectId } = await ctx.params;
  const ticket = findZipTicket(sp.get("ticket") ?? "", user.id, projectId);
  if (!ticket) return new Response(t("No encontrado"), { status: 404 });
  if (sp.get("status") === "1") {
    // Solo memoria: la página lo consulta cada segundo mientras descarga.
    if (!rateLimit(`release-zip-status:${user.id}`, 600, 60_000)) return new Response(t("Demasiadas peticiones"), { status: 429 });
    return Response.json(ticket.status(), { headers: { "Cache-Control": "private, no-store" } });
  }
  const mode = zipRequestMode(req.url);
  if (!mode || mode.kind !== "part" || !mode.explicit) return new Response(t("Datos no válidos"), { status: 400 });
  ticket.reset(mode.part);
  const rate = zipRateKey(mode, user.id);
  const name = sp.get("name");
  let res: Response;
  try {
    res = rateLimit(rate.key, rate.limit, 60_000)
      ? await serveZip(req, t, user, projectId, ticket.items, mode, { name: name && ZIP_FILE_NAME.test(name) ? name : null, ticket })
      : new Response(t("Demasiadas peticiones"), { status: 429 });
  } catch (err) {
    ticket.failed(mode.part, 500, t("No se pudieron descargar los adjuntos"));
    throw err;
  }
  // La descarga directa no deja a la página leer la respuesta: el error queda en el vale para que lo muestre.
  if (!res.ok) ticket.failed(mode.part, res.status, await res.clone().text().catch(() => ""));
  return res;
}

async function serveZip(
  req: Request, t: Awaited<ReturnType<typeof getT>>, user: User, projectId: string, items: Items, mode: Mode,
  opts: { issueTicket?: boolean; name?: string | null; ticket?: Ticket },
): Promise<Response> {
  const start = performance.now();
  const planZip = items[0]!.folder !== undefined;
  const ids = new Set(items.map((i) => i.taskId));
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
  // Cada paquete pesa como mucho el tope del proyecto; si no cabe todo, salen varios.
  const { releaseZipMaxMb } = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { releaseZipMaxMb: true } });

  const candidates: (Omit<ZipEntry, "size"> & { file: string })[] = [];
  for (const item of items) {
    const attachments = byId.get(item.taskId)!.attachments;
    const names = item.folder !== undefined ? plainAttachmentFileNames(attachments).map((n) => `${item.folder}/${n}`) : attachmentFileNames(item.code!, attachments);
    for (const [i, a] of attachments.entries()) {
      const file = attachmentPath(a.id, a.isImage ? "full" : "file");
      candidates.push({ id: a.id, name: names[i]!, file, open: () => createReadStream(file) });
    }
  }
  // Fichero ausente en disco: se omite en lugar de romper toda la descarga.
  const entries = await sizedZipEntries(candidates, (c) => stat(c.file).then((st) => st.size, () => null));
  if (entries.length === 0) return new Response(t("No hay adjuntos disponibles"), { status: 404 });
  const packages = planZipEntries(entries, releaseZipMaxMb);
  if (mode.kind === "plan") {
    const ticket = opts.issueTicket ? issueZipTicket(user.id, projectId, items) : undefined;
    return Response.json(
      { ...zipPlanBody(packages, releaseZipMaxMb, entries), busy: zipSlotBusy(user.id), ...(ticket ? { ticket } : {}) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const conflict = zipVersionConflict(mode, entries, releaseZipMaxMb, t("Los adjuntos han cambiado mientras se descargaban. Vuelve a descargarlos."));
  if (conflict) return conflict;
  const pkg = packages[mode.part - 1];
  if (!pkg) return new Response(t("No encontrado"), { status: 404 });
  // Uno a la vez por persona y pocos en todo el servidor (cada paquete se lee dos veces del disco y se envía en flujo).
  const slot = acquireZipSlot(user.id);
  if (!slot) return new Response(t("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos."), { status: 429, headers: { "Retry-After": "5" } });
  const part = mode.part;
  opts.ticket?.started(part);
  // Con vale, el paquete cuenta como terminado al soltar el hueco: la página pide entonces el siguiente.
  const releaseSlot = () => {
    slot();
    opts.ticket?.finished(part);
  };
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
  logEvent({
    category: "api", action: planZip ? "aiPlan.zipDownload" : "release.zipDownload", message: `ZIP de adjuntos de ${planZip ? "plan de trabajo" : "release"} (paquete ${mode.part}/${packages.length}, ${fileCount} ficheros, ${logSize(zipPart.bytes)})`,
    userId: user.id, userName: user.name, projectId, path: `/api/projects/${projectId}/release-attachments`, ip: clientIp(req.headers),
    durationMs: performance.now() - start, details: { tasks: items.length, part: mode.part, parts: packages.length, files: fileCount, bytes: zipPart.bytes },
  });
  const name = opts.name ?? (planZip ? aiPlanZipName : releaseZipName)({ day: isoDate(new Date(), appTimeZone()) }, mode.part, packages.length, await getLocale());
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
