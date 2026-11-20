import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/session";
import { sharedFile } from "@/lib/share-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un archivo de lo compartido con «Compartir → Pizarro» (share-inbox.ts), para que /share lo pase a «Nueva tarea». Solo
 * para su dueño (la carpeta del envío lleva su id: el de otra persona da 404). Siempre como datos binarios para
 * descargar: el nombre y el tipo reales los lleva la página.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ shareId: string; index: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { shareId, index } = await ctx.params;
  const found = /^\d{1,2}$/.test(index) ? await sharedFile(user.id, shareId, Number(index)) : null;
  if (!found) return new Response("Not Found", { status: 404 });
  const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "x-pz-content-length": String(found.meta.size),
    },
  });
}
