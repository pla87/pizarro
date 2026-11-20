import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { uploadWriteError } from "@/lib/disk-space";
import { cleanFileName } from "@/lib/file-name";
import { logSize } from "@/lib/format-size";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { SHARE_FIELDS, SHARE_MAX_FILES, SHARE_NO_SESSION_MAX_BYTES, shareRequestAllowed, sharedText, shareTextQuery, type ShareError } from "@/lib/share-core";
import { stageShare } from "@/lib/share-inbox";
import { acquireUploadSlot, BodyTooLargeError, declaredLength, readBodyLimited, UploadTooSlowError, withUploadCapHeader } from "@/lib/upload-slots";
import { effectiveFileMaxMb, FILE_MAX_DEFAULT_MB, MULTIPART_OVERHEAD_BYTES } from "@/lib/upload-size";
import { sanitizeMime } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redirección 303 (el navegador sigue con GET) a una ruta de la app; relativa, como permite HTTP: vale tras un proxy. */
const goTo = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
const failed = (error: ShareError) => goTo(`/share?error=${error}`);

/**
 * «Compartir → Pizarro» (share_target del manifiesto): el navegador del móvil o del ordenador manda aquí, como una
 * navegación POST multipart, lo compartido desde otra app (título, texto, enlace y archivos). Se guarda en el almacén
 * temporal de la persona (share-inbox.ts, 30 minutos) y se abre /share, que ofrece «Nueva tarea» con todo ello.
 *
 * Protección: sesión obligatoria (sin ella, al acceso con vuelta a /share y solo los textos, que van en la dirección);
 * origen comprobado con `Sec-Fetch-Site`/`Origin` (shareRequestAllowed: una web ajena no puede mandar nada); los mismos
 * topes que una subida (tamaño, huecos de subida, ritmo) y, sobre todo, sin efectos: guardar lo compartido no crea ni
 * cambia nada. La tarea y sus adjuntos solo se crean cuando la persona pulsa «Crear tarea», por las rutas de siempre.
 * Fuera del proxy (src/proxy.ts), que guardaría en memoria el cuerpo entero; esta ruta lo lee con su propio tope.
 */
async function handlePost(req: Request): Promise<Response> {
  const start = performance.now();
  const ip = clientIp(req.headers);
  if (!shareRequestAllowed({ origin: req.headers.get("origin"), secFetchSite: req.headers.get("sec-fetch-site"), host: req.headers.get("host") }, process.env.APP_URL)) {
    return new Response("Forbidden", { status: 403 });
  }
  const user = await getCurrentUser();
  const length = declaredLength(req.headers);
  if (!user) {
    // Sin sesión no se guarda ningún archivo: solo los textos de un envío pequeño, en la dirección de vuelta.
    let next = "/share?sesion=1";
    if (length !== null && length <= SHARE_NO_SESSION_MAX_BYTES && rateLimit(`share-anon:${ip ?? "?"}`, 20, 60_000)) {
      const form = await readBodyLimited(req, SHARE_NO_SESSION_MAX_BYTES, "formData").catch(() => null);
      if (form) {
        const files = form.getAll(SHARE_FIELDS.files).filter((f) => f instanceof File && f.size > 0).length;
        next = shareTextQuery(sharedText({ title: form.get(SHARE_FIELDS.title), text: form.get(SHARE_FIELDS.text), url: form.get(SHARE_FIELDS.url) }), files);
        next += `${next.includes("?") ? "&" : "?"}sesion=1`;
      }
    }
    return goTo(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!rateLimit(`share:${user.id}`, 20, 60_000)) return failed("rate");
  // Tope: lo que admite un archivo en el proyecto que más admite de los de la persona (el de cada proyecto se vuelve a
  // aplicar al subirlos a la tarea). Todo el envío junto, que se lee entero en memoria como una subida.
  const biggest = await db.project.aggregate({ _max: { fileMaxMb: true }, where: visibleProjectsWhere(user) });
  const maxBytes = effectiveFileMaxMb(biggest._max.fileMaxMb ?? FILE_MAX_DEFAULT_MB) * 1024 * 1024;
  if (length !== null && length > maxBytes + MULTIPART_OVERHEAD_BYTES) return failed("too_big");
  const release = await acquireUploadSlot(user.id, undefined, { declaredBytes: length });
  if (!release) return failed("busy");
  try {
    let form: FormData;
    try {
      form = await readBodyLimited(req, maxBytes + MULTIPART_OVERHEAD_BYTES, "formData");
    } catch (err) {
      return failed(err instanceof BodyTooLargeError ? "too_big" : err instanceof UploadTooSlowError ? "slow" : "failed");
    }
    const text = sharedText({ title: form.get(SHARE_FIELDS.title), text: form.get(SHARE_FIELDS.text), url: form.get(SHARE_FIELDS.url) });
    const all = form.getAll(SHARE_FIELDS.files).filter((f): f is File => f instanceof File && f.size > 0);
    const files = await Promise.all(all.slice(0, SHARE_MAX_FILES).map(async (f) => ({ name: cleanFileName(f.name, "archivo"), type: sanitizeMime(f.type), data: Buffer.from(await f.arrayBuffer()) })));
    if (!files.length && !text.title && !text.text && !text.url) return failed("empty");
    const bytes = files.reduce((n, f) => n + f.data.length, 0);
    let shareId: string;
    try {
      shareId = await stageShare(user.id, text, files);
    } catch (err) {
      const e = uploadWriteError(err, { action: "share.noSpace", bytes, details: { files: files.length } });
      logEvent({ level: "warn", category: "api", action: "share.failed", message: `No se pudo guardar lo compartido: ${e instanceof Error ? e.message : String(e)}`, userId: user.id, userName: user.name, path: "/api/share", ip });
      return failed("failed");
    }
    logEvent({
      category: "api", action: "share.received", message: `Compartido con Pizarro: ${files.length} archivo(s), ${logSize(bytes)}`,
      userId: user.id, userName: user.name, path: "/api/share", ip, durationMs: performance.now() - start,
      details: { files: files.length, skipped: all.length - files.length, bytes, hasText: !!text.text, hasUrl: !!text.url },
    });
    return goTo(`/share?id=${shareId}${all.length > files.length ? `&omitidos=${all.length - files.length}` : ""}`);
  } finally {
    release();
  }
}

export async function POST(req: Request) {
  return withUploadCapHeader(await handlePost(req));
}
