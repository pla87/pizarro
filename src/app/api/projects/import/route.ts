import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { ArchiveError } from "@/lib/project-export/errors";
import { logEvent } from "@/lib/log";
import { importMaxBytes } from "@/lib/project-export/config";
import { peekProjectArchive } from "@/lib/project-export/read";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { assertUserCanQueue, createImportJob } from "@/lib/transfer-jobs";
import { ZipReadError } from "@/lib/zip-read";
import { uploadDir } from "@/lib/upload-dir";
import { acquireUploadSlot, declaredLength } from "@/lib/upload-slots";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 24 * 60 * 60 * 1000;

/** Borra temporales de importaciones que murieron a medias (más de un día). */
async function sweepStale(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      const file = path.join(dir, name);
      if (Date.now() - (await stat(file)).mtimeMs > STALE_MS) await rm(file, { force: true });
    }
  } catch {
    // carpeta inexistente o carrera con otra limpieza: no importa
  }
}

/**
 * Importa un proyecto desde un .pizarro.zip. El cuerpo de la petición ES el archivo (sin multipart), que se guarda por
 * trozos en un temporal para no cargarlo en memoria. `?private=1` crea el proyecto como privado. Solo administradores.
 * Aquí solo se sube y se comprueba lo barato (directorio del ZIP y manifiesto); la importación en sí es un trabajo en
 * segundo plano (lib/transfer-jobs.ts) y la respuesta (202) lleva su id. El hueco de subida se suelta al terminar de recibir.
 */
export async function POST(req: Request) {
  const t = await getT();
  const start = performance.now();
  const ip = clientIp(req.headers);
  const user = await getCurrentUser();
  let release: (() => void) | null = null;
  let temp: string | null = null;
  try {
    if (!isSameOrigin(req)) throw new AppError("Origen no permitido.", 403);
    if (!user) throw new AppError("No autorizado", 401);
    if (user.role !== "ADMIN") throw new AppError("No tienes permiso para esta acción.", 403);
    if (!rateLimit(`project-import:${user.id}`, 5, 10 * 60_000)) throw new AppError("Demasiadas peticiones", 429);
    const isPrivate = new URL(req.url).searchParams.get("private") === "1";
    const max = importMaxBytes();
    const tooBig = () => new AppError(t("El archivo supera el tamaño máximo de importación ({mb} MB).", { mb: Math.round(max / 1024 / 1024) }), 413);
    const length = declaredLength(req.headers);
    if (length !== null && length > max) throw tooBig();
    if (length === 0 || !req.body) throw new AppError("No se ha recibido ningún archivo.");
    await assertUserCanQueue(user.id);
    release = await acquireUploadSlot();
    if (!release) throw new AppError("Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos.", 429, "upload_busy");

    const dir = path.join(/*turbopackIgnore: true*/ uploadDir(), "imports");
    await mkdir(dir, { recursive: true });
    await sweepStale(dir);
    temp = path.join(dir, `${randomBytes(8).toString("hex")}.tmp`);
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > max) cb(tooBig());
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as never), limiter, createWriteStream(temp));
    if (received === 0) throw new AppError("No se ha recibido ningún archivo.");

    await peekProjectArchive(temp);
    // Desde aquí el temporal es del trabajo (lo borra al terminar).
    const job = await createImportJob(user.id, temp, received, isPrivate);
    temp = null;
    logEvent({
      category: "api", action: "projects.importQueued", message: `Importación de un proyecto en cola (${Math.round(received / 1024)} KB)`,
      userId: user.id, userName: user.name, path: "/api/projects/import", ip, durationMs: performance.now() - start, details: { jobId: job.id, bytes: received, isPrivate },
    });
    return Response.json({ ok: true, jobId: job.id }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    const known = err instanceof AppError ? err : err instanceof ZipReadError ? new ArchiveError("El archivo está dañado.", err.message) : null;
    logEvent({
      level: known ? "warn" : "error", category: "api", action: "projects.importFailed",
      message: `Fallo al importar un proyecto: ${err instanceof Error ? err.message : String(err)}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: "/api/projects/import", ip, durationMs: performance.now() - start, details: { status },
    });
    if (known) {
      const headers = known.code === "upload_busy" ? { "Retry-After": "5" } : undefined;
      const message = known instanceof ArchiveError ? `${t(known.base)}${known.detail ? ` (${known.detail})` : ""}` : t(known.message);
      return Response.json({ error: message, ...(known.code ? { code: known.code } : {}) }, { status: known.status, headers });
    }
    console.error("[project import]", err);
    return Response.json({ error: t("No se pudo importar el proyecto.") }, { status: 500 });
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => {});
    release?.();
  }
}
