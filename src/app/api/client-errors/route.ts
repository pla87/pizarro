import { z } from "zod";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  source: z.enum(["error-boundary", "global-error", "window", "promise"]),
  message: z.string().max(2000),
  digest: z.string().max(200).optional(),
  stack: z.string().max(4000).optional(),
  path: z.string().max(500).optional(),
});

const ANON_MAX_BODY = 8_192;

/** Errores del navegador (pantalla «Algo ha fallado», excepciones no capturadas) → Administración → Logs. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const ip = clientIp(req.headers);
  // Sin sesión también se acepta (la pantalla de acceso, la verificación en dos pasos o una sesión caducada fallan sin ella
  // y su error es justo el que hay que ver), con un límite más estricto por IP y un cuerpo más pequeño.
  const user = await getCurrentUser().catch(() => null);
  if (!rateLimit(`client-errors:${user ? "u" : "anon"}:${ip}`, user ? 20 : 10, 60_000)) return new Response(null, { status: 429 });
  const raw = await req.text().catch(() => "");
  if (raw.length > (user ? 16_384 : ANON_MAX_BODY)) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400 });
  const e = parsed.data;
  logEvent({
    level: "error",
    category: "client",
    action: `client.${e.source}`,
    message: `Error en el navegador${user ? "" : " (sin sesión)"}${e.path ? ` en ${e.path}` : ""}: ${e.message}`,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    path: e.path ?? null,
    ip,
    details: { anonymous: !user, digest: e.digest, stack: e.stack, userAgent: req.headers.get("user-agent")?.slice(0, 300) },
  });
  return new Response(null, { status: 204 });
}
