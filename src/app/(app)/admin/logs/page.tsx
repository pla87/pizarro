import Link from "next/link";
import { Download } from "lucide-react";
import { appTimeZone } from "@/lib/board";
import { db } from "@/lib/db";
import { flushLogs, logRetentionDays } from "@/lib/log";
import { isMaskedLog, LOG_RANGES, logQuery, logWhere, memberPrivateProjectIds, parseLogFilters } from "@/lib/log-query";
import { addDays, dayInZone } from "@/lib/log-range";
import { requireAdminPage } from "@/lib/session";
import { cn } from "@/components/ui/cn";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Logs") };
}
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const LEVELS = [
  { value: "info", label: "Info", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { value: "warn", label: "Aviso", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  { value: "error", label: "Error", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
] as const;

const field =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

function formatTime(d: Date, tz: string, locale: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat(locale, { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month} ${p.hour}:${p.minute}:${p.second}`;
}

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireAdminPage();
  const mine = await memberPrivateProjectIds(viewer.id);
  const t = await getT();
  const locale = intlLocale(await getLocale());
  const sp = await searchParams;
  const filters = parseLogFilters(sp);
  const cursor = typeof sp.cursor === "string" && /^[a-z0-9]{1,40}$/i.test(sp.cursor) ? sp.cursor : null;
  const tz = appTimeZone();

  // Escribe los eventos pendientes para que los más recientes aparezcan.
  await flushLogs();

  const [rows, levelCounts, categories, users] = await Promise.all([
    db.appLog.findMany({
      where: logWhere(filters, mine),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.appLog.groupBy({ by: ["level"], where: logWhere(filters, mine, false), _count: { _all: true } }),
    db.appLog.groupBy({ by: ["category"], orderBy: { category: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  const counts = Object.fromEntries(levelCounts.map((c) => [c.level, c._count._all]));
  const days = logRetentionDays();
  const today = dayInZone(new Date(), tz);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {days === 1 ? t("Se conserva 1 día de actividad.") : t("Se conservan {days} días de actividad.", { days })}
          {!filters.reads && " " + t("Se muestran solo los cambios: marca «Incluir consultas» para ver también páginas vistas, tareas abiertas y descargas.")}
        </p>
        <form method="get" action="/api/admin/logs" className="flex flex-wrap items-end gap-2">
          {/* Mismos filtros que la lista; el periodo lo sustituye el intervalo de fechas. */}
          {filters.level && <input type="hidden" name="level" value={filters.level} />}
          {filters.category && <input type="hidden" name="category" value={filters.category} />}
          {filters.userId && <input type="hidden" name="user" value={filters.userId} />}
          {filters.q && <input type="hidden" name="q" value={filters.q} />}
          {filters.reads && <input type="hidden" name="consultas" value="1" />}
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t("Desde")}
            <input type="date" name="desde" defaultValue={addDays(today, -1)} min={addDays(today, -days)} max={today} required className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t("Hasta")}
            <input type="date" name="hasta" defaultValue={today} min={addDays(today, -days)} max={today} required className={field} />
          </label>
          <button
            type="submit"
            title={t("Máximo {days} días", { days })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Download className="size-4" aria-hidden /> {t("Descargar CSV")}
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {LEVELS.map((l) => (
          <Link
            key={l.value}
            href={`/admin/logs${logQuery({ ...filters, level: filters.level === l.value ? "" : l.value })}`}
            className={cn("rounded-full px-3 py-1 font-medium", l.badge, filters.level === l.value && "ring-2 ring-brand-600")}
          >
            {t(l.label)}: {(counts[l.value] ?? 0).toLocaleString(locale)}
          </Link>
        ))}
      </div>

      <form method="get" action="/admin/logs" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t("Periodo")}
          <select name="range" defaultValue={filters.range} className={field}>
            {LOG_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{t(r.label)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t("Nivel")}
          <select name="level" defaultValue={filters.level} className={field}>
            <option value="">{t("Todos")}</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{t(l.label)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t("Categoría")}
          <select name="category" defaultValue={filters.category} className={field}>
            <option value="">{t("Todas")}</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>{c.category}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t("Usuario")}
          <select name="user" defaultValue={filters.userId} className={field}>
            <option value="">{t("Todos")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 self-center text-sm sm:col-span-1 sm:pb-1.5" title={t("Páginas vistas, tareas abiertas, informes y descargas")}>
          <input type="checkbox" name="consultas" value="1" defaultChecked={filters.reads} />
          {t("Incluir consultas")}
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-500 sm:min-w-48 sm:flex-1">
          {t("Buscar (acción, mensaje, ruta)")}
          <input type="search" name="q" defaultValue={filters.q} maxLength={100} className={field} />
        </label>
        <div className="col-span-2 flex gap-2">
          <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-700">
            {t("Filtrar")}
          </button>
          <Link href="/admin/logs" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">
            {t("Limpiar")}
          </Link>
        </div>
      </form>

      {cursor && (
        <Link href={`/admin/logs${logQuery(filters)}`} className="inline-block text-sm text-brand-700 hover:underline dark:text-brand-100">
          {t("← Volver a los más recientes")}
        </Link>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {t("No hay eventos con este filtro.")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {items.map((r) => {
            // Proyecto privado de otra persona: solo hora y usuario.
            if (isMaskedLog(r, mine)) {
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 px-3 py-2 text-sm text-slate-500">
                  <span className="font-mono text-xs">{formatTime(r.createdAt, tz, locale)}</span>
                  {r.userName && <span className="text-xs">· {r.userName}</span>}
                  <span className="italic">{t("Actividad en un proyecto privado")}</span>
                </li>
              );
            }
            const level = LEVELS.find((l) => l.value === r.level) ?? LEVELS[0];
            const hasDetails = r.details !== null && r.details !== undefined;
            return (
              <li key={r.id}>
                <details className="group">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-slate-500">{formatTime(r.createdAt, tz, locale)}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", level.badge)}>{t(level.label)}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{r.category}</span>
                      <span className="font-mono text-xs font-semibold">{r.action}</span>
                      {r.userName && <span className="text-xs text-slate-600 dark:text-slate-300">· {r.userName}</span>}
                      {r.durationMs != null && <span className="ml-auto font-mono text-xs text-slate-500">{r.durationMs} ms</span>}
                    </div>
                    {r.message && <p className="mt-1 break-words text-slate-800 dark:text-slate-100">{r.message}</p>}
                    {r.path && <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{r.path}</p>}
                  </summary>
                  <div className="space-y-1 bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/60">
                    <p className="text-slate-500">
                      {t("IP: {ip} · Usuario: {user} · Proyecto: {project}", { ip: r.ip ?? "—", user: r.userId ?? "—", project: r.projectId ?? "—" })}
                    </p>
                    {hasDetails ? (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono dark:bg-slate-950">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-slate-500">{t("Sin detalles.")}</p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="text-center">
          <Link
            href={`/admin/logs${logQuery(filters, { cursor: items[items.length - 1]!.id })}`}
            className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {t("Cargar más")}
          </Link>
        </div>
      )}
    </div>
  );
}
