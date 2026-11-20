import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/access";
import * as v from "@/lib/validation";
import { importTasks } from "@/lib/task-import";
import { TASKS_TEXT_MAX_BYTES, TASKS_TEXT_MAX_CHARS } from "@/lib/task-json";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser, getPendingUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { acquireUploadSlot, BodyTooLargeError, withUploadCapHeader, declaredLength, readBodyLimited, UPLOAD_TOO_SLOW_MESSAGE, UploadTooSlowError } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Importar tareas» del tablero (ImportTasksDialog): el cuerpo es el texto tal cual (UTF-8, `text/plain`) y la columna
 * forzada, si la hay, va en `?columnId=`. No es una acción de servidor porque las acciones admiten como mucho 1 MB y una
 * exportación de 500 tareas pasa de ahí: aquí el cuerpo se lee con su propio tope (TASKS_TEXT_MAX_BYTES; después cuenta
 * TASKS_TEXT_MAX_CHARS). Por eso queda fuera del matcher de src/proxy.ts, que guardaría en memoria hasta 2 MB y descartaría
 * el resto: el origen y la sesión se comprueban aquí, antes de leer nada. Hace lo mismo que hacía la acción, con su
 * nombre en el registro (`tasks.importTasks`, dentro de runAction: historial, deshacer y aviso a las demás pestañas).
 * Ocupa un hueco de subida (como mucho unas pocas a la vez: cada una se lee entera en memoria) y, como cualquier petición
 * en curso, el apagado ordenado la espera (src/lib/shutdown.ts).
 *
 * Respuestas: 200 con `{ ok: true, data }` o `{ ok: false, error }` (lo mismo que devolvía la acción); 401 sin sesión,
 * 403 de otro origen o con la contraseña pendiente de cambiar, 413 si el texto es demasiado grande, 429 con demasiadas
 * seguidas o sin hueco, 408 si llega demasiado despacio. En los de error, `{ error }` ya traducido. Todas llevan el tope
 * actual de subidas por persona (withUploadCapHeader).
 *
 * Un texto pequeño (Content-Length declarado por debajo de SMALL_BODY_BYTES: lo normal al pegar o importar unas pocas
 * tareas) no cuenta para el tope de una subida a la vez por persona, solo para el global: no espera a un adjunto lento
 * de la misma persona.
 */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  return withUploadCapHeader(await handlePost(req, ctx));
}

async function handlePost(req: Request, ctx: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const t = await getT();
  const fail = (status: number, error: string, headers?: Record<string, string>) => NextResponse.json({ ok: false, error: t(error) }, { status, headers });
  if (!isSameOrigin(req)) return fail(403, "Origen no permitido.");
  if (!rateLimit(`import-tasks:ip:${rateIp(clientIp(req.headers))}`, 60, 60_000)) return fail(429, "Demasiadas importaciones seguidas. Espera un momento.", { "Retry-After": "60" });
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    const pending = await getPendingUser().catch(() => null);
    return pending ? fail(403, "Debes elegir una contraseña nueva antes de continuar.") : fail(401, "Sesión caducada. Vuelve a iniciar sesión.");
  }
  const tooBig = () => NextResponse.json({ ok: false, error: t("El texto es demasiado largo para importarlo (máximo {mb} MB).", { mb: TASKS_TEXT_MAX_CHARS / 1_000_000 }) }, { status: 413 });
  const declared = declaredLength(req.headers);
  if (declared !== null && declared > TASKS_TEXT_MAX_BYTES) return tooBig();
  // Antes de ocupar un hueco de subida (hay pocos, compartidos con adjuntos y documentos) y de leer el cuerpo: el proyecto
  // debe existir y ser visible para quien importa, y su ritmo, razonable. Si no, quien no tiene acceso podría ocupar los
  // huecos de todos enviando el texto despacio.
  const { projectId } = await ctx.params;
  const pid = v.id.safeParse(projectId);
  const visible = pid.success && (await assertProjectAccess(user, pid.data).then(() => true, () => false));
  if (!visible) return fail(404, "No encontrado o sin acceso.");
  if (!rateLimit(`import-tasks:body:${user.id}`, 10, 60_000)) return fail(429, "Demasiadas importaciones seguidas. Espera un momento.", { "Retry-After": "60" });
  const release = await acquireUploadSlot(user.id, undefined, { declaredBytes: declared });
  if (!release) return fail(429, "Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos.", { "Retry-After": "5" });
  try {
    let text: string;
    try {
      text = await readBodyLimited(req, TASKS_TEXT_MAX_BYTES, "text");
    } catch (err) {
      if (err instanceof BodyTooLargeError) return tooBig();
      if (err instanceof UploadTooSlowError) return fail(408, UPLOAD_TOO_SLOW_MESSAGE);
      throw err;
    }
    if (text.length > TASKS_TEXT_MAX_CHARS) return tooBig();
    const columnId = new URL(req.url).searchParams.get("columnId") || null;
    return NextResponse.json(await importTasks(projectId, text, { columnId }));
  } finally {
    release();
  }
}
