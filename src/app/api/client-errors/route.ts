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

/** Errores del navegador (pantalla «Algo ha fallado», excepciones no capturadas) → Administración → Logs. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const ip = clientIp(req.headers);
  if (!rateLimit(`client-errors:${ip}`, 20, 60_000)) return new Response(null, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const user = await getCurrentUser().catch(() => null);
  const e = parsed.data;
  logEvent({
    level: "error",
    category: "client",
    action: `client.${e.source}`,
    message: `Error en el navegador${e.path ? ` en ${e.path}` : ""}: ${e.message}`,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    path: e.path ?? null,
    ip,
    details: { digest: e.digest, stack: e.stack, userAgent: req.headers.get("user-agent")?.slice(0, 300) },
  });
  return new Response(null, { status: 204 });
}
