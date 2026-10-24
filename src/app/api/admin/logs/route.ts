import { db } from "@/lib/db";
import { flushLogs, logRetentionDays } from "@/lib/log";
import { isMaskedLog, logWhere, memberPrivateProjectIds, parseLogFilters } from "@/lib/log-query";
import { appTimeZone } from "@/lib/board";
import { parseExportRange } from "@/lib/log-range";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";

export const runtime = "nodejs";

const PAGE = 1000;
const MAX_ROWS = 200_000;

/** Celda CSV: comillas dobles y neutralización de fórmulas (=, +, -, @) al abrir en Excel. */
function cell(v: unknown): string {
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Descarga en CSV de los logs con el filtro actual y un intervalo de fechas (solo administradores; por defecto, el último día). */
export async function GET(req: Request) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return new Response(t("No autorizado"), { status: 401 });
  if (user.role !== "ADMIN") return new Response(t("Prohibido"), { status: 403 });

  const params = new URL(req.url).searchParams;
  const tz = appTimeZone();
  const days = logRetentionDays();
  const range = parseExportRange(params.get("desde"), params.get("hasta"), { tz, retentionDays: days });
  if (!range.ok) {
    const msg =
      range.error === "order" ? t("La fecha «desde» no puede ser posterior a «hasta».")
      : range.error === "too_long" ? t("El intervalo no puede superar {days} días (lo que se conservan los logs).", { days })
      : t("Fechas no válidas.");
    return new Response(msg, { status: 400 });
  }

  await flushLogs();
  const mine = await memberPrivateProjectIds(user.id);
  const where = logWhere({ ...parseLogFilters(Object.fromEntries(params)), period: { gte: range.gte, lt: range.lt } }, mine);

  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "medium" });
  const header = ["fecha", "nivel", "categoria", "accion", "usuario", "usuario_id", "proyecto_id", "mensaje", "duracion_ms", "ruta", "ip", "detalles"];
  const enc = new TextEncoder();
  let cursor: string | null = null;
  let sent = 0;
  let first = true;
  // Se escribe por páginas de 1000 filas (paginación por cursor): nunca hay todo el CSV en memoria.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const rows: Awaited<ReturnType<typeof db.appLog.findMany>> = sent >= MAX_ROWS ? [] : await db.appLog.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: Math.min(PAGE, MAX_ROWS - sent),
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const lines: string[] = first ? [header.map(cell).join(",")] : [];
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
        if (lines.length) controller.enqueue(enc.encode((first ? "\uFEFF" : "\r\n") + lines.join("\r\n")));
        first = false;
        sent += rows.length;
        cursor = rows.at(-1)?.id ?? null;
        if (rows.length < PAGE || sent >= MAX_ROWS) controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="logs-pizarro-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
