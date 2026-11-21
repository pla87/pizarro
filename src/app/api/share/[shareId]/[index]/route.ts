import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/session";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";
import { sharedFile } from "@/lib/share-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un archivo de lo compartido con «Compartir → Pizarro» (share-inbox.ts), para que /share lo pase a «Nueva tarea». Solo
 * para su dueño (la carpeta del envío lleva su id: el de otra persona da 404). Siempre como datos binarios para
 * descargar: el nombre y el tipo reales los lleva la página.
 */
export function GET(_req: Request, ctx: { params: Promise<{ shareId: string; index: string }> }) {
  return serve(ctx, false);
}

/** HEAD: las mismas cabeceras sin abrir el fichero (derivado de GET, Next abría el flujo y no lo cerraba nunca). */
export function HEAD(_req: Request, ctx: { params: Promise<{ shareId: string; index: string }> }) {
  return serve(ctx, true);
}

async function serve(ctx: { params: Promise<{ shareId: string; index: string }> }, head: boolean): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { shareId, index } = await ctx.params;
  const found = /^\d{1,2}$/.test(index) ? await sharedFile(user.id, shareId, Number(index)) : null;
  if (!found) return new Response("Not Found", { status: 404 });
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": "attachment",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Length": String(found.meta.size),
    // Next quita el Content-Length al copiar la respuesta: el gancho de response-length.ts lo repone.
    [DECLARED_LENGTH_HEADER]: String(found.meta.size),
  };
  if (head) return new Response(null, { headers });
  return new Response(Readable.toWeb(createReadStream(found.path)) as ReadableStream<Uint8Array>, { headers });
}
