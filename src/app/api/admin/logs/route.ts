import { db } from "@/lib/db";
import { flushLogs } from "@/lib/log";
import { isMaskedLog, logWhere, memberPrivateProjectIds, parseLogFilters } from "@/lib/log-query";
import { appTimeZone } from "@/lib/board";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";

const MAX_ROWS = 20_000;

/** Celda CSV: comillas dobles y neutralización de fórmulas (=, +, -, @) al abrir en Excel. */
function cell(v: unknown): string {
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Descarga en CSV de los logs con el filtro actual (solo administradores, máx. 20 000 filas). */
export async function GET(req: Request) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (user.role !== "ADMIN") return new Response(t("Prohibido"), { status: 403 });

  await flushLogs();
  const mine = await memberPrivateProjectIds(user.id);
  const filters = parseLogFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await db.appLog.findMany({
    where: logWhere(filters, mine),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
  });

  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: appTimeZone(), dateStyle: "short", timeStyle: "medium" });
  const header = ["fecha", "nivel", "categoria", "accion", "usuario", "usuario_id", "proyecto_id", "mensaje", "duracion_ms", "ruta", "ip", "detalles"];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    // Proyecto privado de otra persona: solo hora y usuario.
    if (isMaskedLog(r, mine)) {
      lines.push([fmt.format(r.createdAt), "", "", "", r.userName, r.userId, "", "Actividad en un proyecto privado", "", "", "", ""].map(cell).join(","));
      continue;
    }
    lines.push(
      [fmt.format(r.createdAt), r.level, r.category, r.action, r.userName, r.userId, r.projectId, r.message, r.durationMs, r.path, r.ip, r.details]
        .map(cell)
        .join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="logs-pizarro-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
