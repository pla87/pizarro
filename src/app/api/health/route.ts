import { db } from "@/lib/db";
import { checkUploads, evaluateHealth, minFreeBytes } from "@/lib/health";
import { isShuttingDown } from "@/lib/shutdown";
import { uploadDir } from "@/lib/upload-dir";

export const dynamic = "force-dynamic";

/** Comprobación de salud (Railway, Docker, Caddy): 200 si todo va bien; 503 con un motivo corto si no. */
export async function GET() {
  // Apagado en marcha (lib/shutdown.ts): el balanceador deja de mandar tráfico a esta instancia mientras termina lo que
  // tiene en curso.
  if (isShuttingDown()) return Response.json({ status: "error", reason: "shutting_down" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
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
