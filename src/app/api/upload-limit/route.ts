import { getCurrentUser } from "@/lib/session";
import { UPLOAD_PER_USER_HEADER } from "@/lib/upload-queue";
import { uploadPerUserCap } from "@/lib/upload-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tope actual de subidas a la vez por persona (3 si solo hay una activa, 1 si hay más; upload-slots.ts), en la cabecera
 * UPLOAD_PER_USER_HEADER y en `{ perUser }`. Lo pregunta la cola del navegador (upload-queue.ts) antes de una tanda de
 * varias subidas si no tiene uno reciente, para no enviar tres cuerpos cuando solo uno va a tener hueco. Sin consultas a
 * la base más allá de la sesión (que además anota la actividad de quien pregunta).
 */
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const perUser = uploadPerUserCap();
  return Response.json({ perUser }, { headers: { "Cache-Control": "private, no-store", [UPLOAD_PER_USER_HEADER]: String(perUser) } });
}
