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

const html = (body: string, status: number) =>
  new Response(body, { status, headers: { ...shareResponseHeaders(), "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": SHARE_PAGE_CSP } });

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req.headers);
  const { locale, t } = await shareLocale();
  if (!shareIpAllowed(ip)) return html(shareMessageHtml("rate", locale, t), 429);
  const { token } = await ctx.params;
  const resolved = await resolveShareToken(token);
  if (!resolved) return html(shareMessageHtml("notFound", locale, t), 404);
  if (resolved.kind === "expired") return html(shareMessageHtml("expired", locale, t), 410);
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
