import { isSameOrigin } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { dropShare } from "@/lib/share-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Borra lo compartido (share-inbox.ts) al crear la tarea o al descartarla en /share. Solo el de la propia persona. */
export async function DELETE(req: Request, ctx: { params: Promise<{ shareId: string }> }) {
  if (!isSameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  await dropShare(user.id, (await ctx.params).shareId);
  return new Response(null, { status: 204 });
}
