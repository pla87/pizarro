import { logError, logEvent } from "@/lib/log";
import { appUrl } from "@/lib/mail";
import { clientIp } from "@/lib/request";
import { isRowId } from "@/lib/row-id";
import { shareFormAllowed, shareResponseHeaders } from "@/lib/share-out-core";
import { applyShareChange, noteShareUse, resolveShareToken, shareIpAllowed } from "@/lib/share-out";
import { BodyTooLargeError, readBodyLimited } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Formularios de la página de «Compartir fuera» (marcar como hecha, cambiar la fecha, comentar): POST normal desde la
// propia página, que vuelve a ella (303) con el aviso en `?m=`. Sin sesión: la credencial es el token de la dirección.
// Comprueba que el formulario viene de la página (shareFormAllowed), los topes por IP y por enlace, que la tarea es de
// las publicadas y sigue viva, y el tamaño del cuerpo.

/** Un comentario de 2.000 caracteres (hasta 4 bytes cada uno) y los campos del formulario, con margen. */
const MAX_BODY = 16 * 1024;

const back = (token: string, query = "", hash = "") =>
  new Response(null, { status: 303, headers: { ...shareResponseHeaders(), Location: `/x/${encodeURIComponent(token)}${query}${hash}` } });
const plain = (text: string, status: number) => new Response(text, { status, headers: { ...shareResponseHeaders(), "Content-Type": "text/plain; charset=utf-8" } });

/** Abrir la dirección del formulario: a la página. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return back((await ctx.params).token);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string; taskId: string }> }) {
  const ip = clientIp(req.headers);
  const { token, taskId } = await ctx.params;
  if (!shareIpAllowed(ip)) return back(token, "?m=rate");
  const allowed = shareFormAllowed({ secFetchSite: req.headers.get("sec-fetch-site"), origin: req.headers.get("origin"), host: req.headers.get("host") }, appUrl());
  if (!allowed) return plain("Forbidden", 403);
  const resolved = await resolveShareToken(token);
  // Caducado, revocado o desconocido: la página lo dice.
  if (resolved?.kind !== "active") return back(token);
  if (!isRowId(taskId)) return back(token, "?m=gone");
  const start = performance.now();
  try {
    const type = req.headers.get("content-type") ?? "";
    const form = type.startsWith("multipart/form-data")
      ? await readBodyLimited(req, MAX_BODY, "formData")
      : new URLSearchParams(await readBodyLimited(req, MAX_BODY, "text"));
    const field = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v : undefined;
    };
    const notice = await applyShareChange(resolved.share, taskId, { op: field("op") ?? "", due: field("due"), body: field("body") }, ip);
    // Hacer algo en la página también es usarla.
    await noteShareUse(resolved.share);
    return back(token, `?m=${notice}`, `#t-${encodeURIComponent(taskId)}`);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return back(token, "?m=invalid", `#t-${encodeURIComponent(taskId)}`);
    logEvent({ level: "error", category: "api", action: "shareOut.failed", label: { k: "Fallo de una acción de «Compartir fuera»: {error}", p: { error: logError(err) } }, projectId: resolved.share.projectId, path: "/x/…", ip, durationMs: performance.now() - start });
    return plain("Internal error", 500);
  }
}
