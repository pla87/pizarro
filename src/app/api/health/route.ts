import { db } from "@/lib/db";
import { checkUploads, evaluateHealth, minFreeBytes } from "@/lib/health";
import { uploadDir } from "@/lib/upload-dir";

export const dynamic = "force-dynamic";

/** Comprobación de salud (Railway, Docker, Caddy): 200 si todo va bien; 503 con un motivo corto si no. */
export async function GET() {
  const [dbOk, uploads] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    checkUploads(uploadDir()),
  ]);
  const result = evaluateHealth({ dbOk, uploads, minFreeBytes: minFreeBytes() });
  const headers = { "Cache-Control": "no-store" };
  if (result.ok) return Response.json({ status: "ok" }, { headers });
  return Response.json({ status: "error", reason: result.reason }, { status: 503, headers });
}
