import { db } from "@/lib/db";
import { flushLogs, logEvent, logRetentionDays } from "@/lib/log";
import { isMaskedLog, logsAfter, logWhere, memberPrivateProjectIds, parseLogFilters } from "@/lib/log-query";
import { appTimeZone } from "@/lib/board";
import { parseExportRange } from "@/lib/log-range";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

export const runtime = "nodejs";

const PAGE = 1000;
const MAX_ROWS = 200_000;
/** Descargas por administrador cada 10 minutos (cada una puede leer 200 000 filas). */
const CSV_LIMIT = 5;

// Una descarga a la vez por administrador (en globalThis, como el limitador): id → cuándo empezó. Se libera al terminar,
// fallar o cortarse; por si un flujo quedara sin cerrar, una marca de más de 10 minutos ya no cuenta.
const BUSY_MAX_MS = 10 * 60_000;
const g = globalThis as unknown as { __pzLogsCsvBusy?: Map<string, number> };
const busy = (g.__pzLogsCsvBusy ??= new Map());

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

  if (Date.now() - (busy.get(user.id) ?? 0) < BUSY_MAX_MS) {
    return new Response(t("Ya tienes una descarga de logs en curso. Espera a que termine."), { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  if (!rateLimit(`logs-csv:${user.id}`, CSV_LIMIT, 10 * 60_000)) {
    return new Response(t("Demasiadas descargas de logs. Espera unos minutos."), { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const filters = parseLogFilters(Object.fromEntries(params));
  // Quién descargó qué intervalo. Los filtros, sin datos personales: ni la persona ni el texto buscado (solo si lo había).
  logEvent({
    category: "api",
    action: "admin.logsCsv",
    message: `Descarga de los logs en CSV (del ${range.from} al ${range.to})`,
    userId: user.id,
    userName: user.name,
    path: "/api/admin/logs",
    ip: clientIp(req.headers),
    details: { from: range.from, to: range.to, level: filters.level || null, category: filters.category || null, search: !!filters.q, reads: filters.reads },
  });
  const startedAt = Date.now();
  busy.set(user.id, startedAt);
  // Solo la suya: si caducó y ya empezó otra, no la libera.
  const release = () => {
    if (busy.get(user.id) === startedAt) busy.delete(user.id);
  };
  let mine: string[];
  try {
    await flushLogs();
    mine = await memberPrivateProjectIds(user.id);
  } catch (err) {
    release();
    throw err;
  }
  const where = logWhere({ ...filters, period: { gte: range.gte, lt: range.lt } }, mine);
  const truncatedLine = t("Recortado a {n} filas: acorta el intervalo.", { n: MAX_ROWS.toLocaleString(intlLocale(await getLocale())) });

  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "medium" });
  const header = ["fecha", "nivel", "categoria", "accion", "usuario", "usuario_id", "proyecto_id", "mensaje", "duracion_ms", "ruta", "ip", "detalles"];
  const enc = new TextEncoder();
  let last: { createdAt: Date; id: string } | null = null;
  let sent = 0;
  let first = true;
  // Se escribe por páginas de 1000 filas (paginación por clave, desde la última fila enviada): nunca hay todo el CSV en
  // memoria y cada página empieza en el índice donde acabó la anterior.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const rows = await db.appLog.findMany({
          where: last ? { AND: [where, logsAfter(last)] } : where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: Math.min(PAGE, MAX_ROWS - sent),
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
        sent += rows.length;
        last = rows.at(-1) ?? last;
        const done = rows.length < PAGE || sent >= MAX_ROWS;
        // En el tope, si quedaban filas, lo dice la última línea (antes se cortaba sin avisar).
        if (sent >= MAX_ROWS && last && (await db.appLog.findFirst({ where: { AND: [where, logsAfter(last)] }, select: { id: true } }))) {
          lines.push(cell(truncatedLine));
        }
        if (lines.length) controller.enqueue(enc.encode((first ? "\uFEFF" : "\r\n") + lines.join("\r\n")));
        first = false;
        if (done) {
          release();
          controller.close();
        }
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    cancel() {
      release();
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
