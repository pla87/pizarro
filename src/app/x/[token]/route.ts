import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/request";
import { isShareNotice, SHARE_PAGE_CSP, SHARE_USE_WRITE_MS, shareResponseHeaders } from "@/lib/share-out-core";
import { loadSharePage, noteShareUse, resolveShareToken, shareIpAllowed, shareLocale } from "@/lib/share-out";
import { shareMessageHtml, sharePageHtml } from "@/lib/share-out-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// «Compartir fuera»: la página sin cuenta de una columna (lib/share-out.ts). Fuera del proxy de sesión: el token de la
// dirección es la credencial. HTML mínimo hecho aquí (sin el AppShell ni el JavaScript de la app); los cambios van por
// formularios POST a /x/<token>/t/<tarea>. Un enlace caducado o revocado dice «ha caducado» 30 días; después, o si nunca
// existió, «no encontrado». El token nunca llega a los registros (ruta «/x/…», secret-path.ts).

const html = (body: string | null, status: number) =>
  new Response(body, { status, headers: { ...shareResponseHeaders(), "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": SHARE_PAGE_CSP } });

type Ctx = { params: Promise<{ token: string }> };

export function GET(req: Request, ctx: Ctx) {
  return serve(req, ctx, false);
}

/**
 * HEAD: el mismo estado (200, 404, 410 o 429) y las mismas cabeceras, sin cuerpo: no cuenta como uso, no deja «Abrieron la
 * web» en Logs ni lee las tareas (derivado de GET, Next montaba la página entera para tirarla).
 */
export function HEAD(req: Request, ctx: Ctx) {
  return serve(req, ctx, true);
}

async function serve(req: Request, ctx: Ctx, head: boolean): Promise<Response> {
  const ip = clientIp(req.headers);
  const { locale, t } = await shareLocale();
  const reply = (body: () => string, status: number) => html(head ? null : body(), status);
  if (!shareIpAllowed(ip)) return reply(() => shareMessageHtml("rate", locale, t), 429);
  const { token } = await ctx.params;
  const resolved = await resolveShareToken(token);
  if (!resolved) return reply(() => shareMessageHtml("notFound", locale, t), 404);
  if (resolved.kind === "expired") return reply(() => shareMessageHtml("expired", locale, t), 410);
  if (head) return html(null, 200);
  const { share } = resolved;
  const first = !share.lastUsedAt || Date.now() - share.lastUsedAt.getTime() >= SHARE_USE_WRITE_MS;
  await noteShareUse(share);
  // Las visitas, como mucho una por enlace y hora en el registro (la misma vez que se apunta el uso).
  if (first) {
    logEvent({ category: "api", action: "shareOut.open", label: { k: "Abrieron la web de «Compartir fuera» de la columna «{col}»", p: { col: share.columnName } }, projectId: share.projectId, path: "/x/…", ip, details: { shareId: share.id } });
  }
  const m = new URL(req.url).searchParams.get("m");
  const { data, t: pageT } = await loadSharePage(share, token, isShareNotice(m) ? m : null);
  return html(sharePageHtml(data, pageT), 200);
}
