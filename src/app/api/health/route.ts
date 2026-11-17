import { db } from "@/lib/db";
import { checkUploads, evaluateHealth, HEALTH_CACHE_MS, minFreeBytes } from "@/lib/health";
import { memo } from "@/lib/memo";
import { isShuttingDown } from "@/lib/shutdown";
import { uploadDir } from "@/lib/upload-dir";

export const dynamic = "force-dynamic";

/** Comprobación de salud (Railway, Docker, Caddy): 200 si todo va bien; 503 con un motivo corto si no. */
export async function GET() {
  // Apagado en marcha (lib/shutdown.ts): el balanceador deja de mandar tráfico a esta instancia mientras termina lo que
  // tiene en curso. Va antes de lo guardado: se responde al instante aunque haya un resultado reciente.
  if (isShuttingDown()) return Response.json({ status: "error", reason: "shutting_down" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  // Es pública y sin límite: el resultado se guarda unos segundos y las peticiones simultáneas comparten la comprobación.
  const result = await memo(HEALTH_MEMO_KEY, checkHealth, HEALTH_CACHE_MS);
  const headers = { "Cache-Control": "no-store" };
  if (result.ok) return Response.json({ status: "ok" }, { headers });
  return Response.json({ status: "error", reason: result.reason }, { status: 503, headers });
}

const HEALTH_MEMO_KEY = "health:check";

async function checkHealth() {
  const [dbOk, uploads] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    checkUploads(uploadDir()),
  ]);
  return evaluateHealth({ dbOk, uploads, minFreeBytes: minFreeBytes() });
}
