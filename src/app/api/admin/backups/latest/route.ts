import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { backupDownloadTokenValid, consumeBackupDownloadToken } from "@/lib/backup-download";
import { latestBackupPath } from "@/lib/backup";
import { logEvent } from "@/lib/log";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";
import { DECLARED_LENGTH_HEADER } from "@/lib/response-length";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Descarga la última copia de seguridad (ya cifrada con BACKUP_KEY). Solo administradores y con el token de un solo uso de la confirmación de contraseña. */
export function GET(req: Request) {
  return serve(req, false);
}

/**
 * HEAD: las mismas cabeceras que GET sin abrir el fichero, sin registrar una descarga y sin gastar el token. Derivado de
 * GET, Next gastaba el token, anotaba la descarga y abría el flujo del fichero sin cerrarlo nunca.
 */
export function HEAD(req: Request) {
  return serve(req, true);
}

async function serve(req: Request, head: boolean): Promise<Response> {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (user.role !== "ADMIN") return new Response(t("Prohibido"), { status: 403 });
  // Hace falta el token de un solo uso que emite requestBackupDownload tras confirmar la contraseña.
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const tokenOk = !!token && (head ? backupDownloadTokenValid(token, user.id) : consumeBackupDownloadToken(token, user.id));
  if (!tokenOk) return new Response(t("Prohibido"), { status: 403, headers: { "Cache-Control": "no-store" } });
  const latest = await latestBackupPath();
  if (!latest) return new Response(t("No encontrado"), { status: 404 });
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(latest.bytes),
    // Next quita el Content-Length al copiar la respuesta: el gancho de response-length.ts lo repone.
    [DECLARED_LENGTH_HEADER]: String(latest.bytes),
    "Content-Disposition": `attachment; filename="${latest.name}"`,
    "Cache-Control": "no-store",
  };
  if (head) return new Response(null, { headers });
  logEvent({
    category: "api",
    action: "backups.download",
    message: `Descarga de la copia ${latest.name}`,
    userId: user.id,
    userName: user.name,
    path: "/api/admin/backups/latest",
  });
  return new Response(Readable.toWeb(createReadStream(latest.file)) as ReadableStream, { headers });
}
