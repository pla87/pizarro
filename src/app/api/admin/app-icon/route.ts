import { runAction } from "@/lib/action";
import { APP_ICON_ACCENTS } from "@/lib/app-icon-core";
import { changeAppIcon } from "@/lib/app-icon-save";
import { rateIp, rateLimit } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { BodyTooLargeError, declaredLength, readBodyLimited } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuerpo: `{"accent":"forest"}`; sobra con muy poco. */
const MAX_BODY = 256;

/**
 * Administración → Ajustes → «Icono de la app»: guardado del color elegido con las flechas cuando la pestaña se cierra,
 * se recarga o se oculta antes de que venza la espera (AppIconSettingsSection lo manda con navigator.sendBeacon, que
 * sobrevive al cierre; una acción de servidor no). Hace lo mismo que la acción `saveAppIcon` y queda en el registro con
 * el mismo nombre, `settings.saveAppIcon`. El navegador no lee la respuesta: los códigos solo sirven para las pruebas.
 */
export async function POST(req: Request) {
  // CSRF: como el resto de rutas POST, el Origin debe ser el de la app (sendBeacon lo manda).
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const ip = clientIp(req.headers);
  // Límite grueso por IP antes de consultar la sesión.
  if (!rateLimit(`app-icon-beacon:ip:${rateIp(ip)}`, 60, 60_000)) return new Response(null, { status: 429 });
  const user = await getCurrentUser().catch(() => null);
  if (!user) return new Response(null, { status: 401 });
  if (user.role !== "ADMIN") return new Response(null, { status: 403 });
  if (!rateLimit(`app-icon-beacon:u:${user.id}`, 20, 60_000)) return new Response(null, { status: 429 });
  const declared = declaredLength(req.headers);
  if (declared !== null && declared > MAX_BODY) return new Response(null, { status: 413 });
  let raw = "";
  try {
    raw = await readBodyLimited(req, MAX_BODY, "text");
  } catch (err) {
    if (err instanceof BodyTooLargeError) return new Response(null, { status: 413 });
    throw err;
  }
  let accent: unknown = null;
  try {
    accent = (JSON.parse(raw) as { accent?: unknown } | null)?.accent;
  } catch {}
  if (typeof accent !== "string" || !(APP_ICON_ACCENTS as readonly string[]).includes(accent)) return new Response(null, { status: 400 });
  // Lo mismo que la acción `saveAppIcon`, con su nombre en el registro (sin importarla: ver app-icon-save.ts).
  const res = await runAction({ name: "settings.saveAppIcon", args: [accent] }, () => changeAppIcon(accent));
  return new Response(null, { status: res.ok ? 204 : 400 });
}
