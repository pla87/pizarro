"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import { TRANSFER_QUEUED_EVENT, isFinal, type TransferJobView } from "./client";
import { TransferProgress } from "./TransferProgress";

export const downloadUrl = (id: string) => `/api/transfer-jobs/${id}/download`;

/** Botón de descarga del archivo de una exportación lista (descarga normal del navegador, en flujo). */
export function DownloadButton({ id, size, className = "btn-primary" }: { id: string; size?: number; className?: string }) {
  const t = useT();
  const locale = useIntlLocale();
  // Con la coma decimal del idioma: «(0,1 MB)» en español.
  const mb = size ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0.1, Math.round((size / 1048576) * 10) / 10)) : null;
  return (
    <a className={className} href={downloadUrl(id)} download data-testid="transfer-download">
      <Download size={15} /> {t("Descargar")}
      {mb ? <span className="text-xs opacity-80">({mb} MB)</span> : null}
    </a>
  );
}

function Row({ job }: { job: TransferJobView }) {
  const t = useT();
  const locale = useIntlLocale();
  const when = new Date(job.createdAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const exp = job.kind === "EXPORT";
  const result = job.result;
  return (
    <li className="space-y-1.5 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700" data-testid="transfer-row" data-status={job.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{exp ? t("Exportación") : t("Importación")}</span>
          <span className="ml-2 text-xs text-slate-500">{when}</span>
        </span>
        {job.status === "DONE" && exp && result && "size" in result && <DownloadButton id={job.id} size={result.size} className="btn-secondary" />}
        {job.status === "DONE" && !exp && job.projectId && <Link className="btn-secondary" href={`/p/${job.projectId}`}>{t("Abrir proyecto")}</Link>}
      </div>
      {(job.status === "QUEUED" || job.status === "RUNNING") && <TransferProgress job={job} />}
      {job.status === "DONE" && exp && <p className="text-xs text-slate-500">{t("Disponible hasta {date}.", { date: job.expiresAt ? new Date(job.expiresAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "" })}</p>}
      {job.status === "DONE" && !exp && result && "name" in result && "counts" in result && <p className="text-xs text-slate-500">{result.counts.tasks === 1 ? t("«{name}» importado (1 tarjeta).", { name: result.name }) : t("«{name}» importado ({tasks} tarjetas).", { name: result.name, tasks: result.counts.tasks })}</p>}
      {job.status === "FAILED" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{job.error ?? t("No se pudo completar.")}</p>}
      {job.status === "EXPIRED" && <p className="text-xs text-slate-500">{t("El archivo ha caducado (24 h). Vuelve a exportar el proyecto.")}</p>}
    </li>
  );
}

/**
 * Exportaciones o importaciones de las últimas 24 h de la persona (las de un proyecto, si se indica). Se actualiza cada
 * 3 s mientras alguna siga en curso y cuando se pone una nueva en cola. `skipId` oculta la que ya se enseña aparte.
 */
export function TransferJobs({ kind, projectId, skipId = null, title }: { kind: "EXPORT" | "IMPORT"; projectId?: string; skipId?: string | null; title: string }) {
  const [jobs, setJobs] = useState<TransferJobView[] | null>(null);
  const [tick, setTick] = useState(0);
  const query = `kind=${kind}${projectId ? `&projectId=${projectId}` : ""}`;
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener(TRANSFER_QUEUED_EVENT, refresh);
    return () => window.removeEventListener(TRANSFER_QUEUED_EVENT, refresh);
  }, [refresh]);
  const active = jobs?.some((j) => !isFinal(j.status)) ?? false;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/transfer-jobs?${query}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { jobs: TransferJobView[] }) => !cancelled && setJobs(b.jobs))
      .catch(() => !cancelled && setJobs((prev) => prev ?? []));
    return () => { cancelled = true; };
  }, [query, tick]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [active, jobs, refresh]);
  const shown = (jobs ?? []).filter((j) => j.id !== skipId);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="transfer-list">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul className="space-y-2">{shown.map((j) => <Row key={j.id} job={j} />)}</ul>
    </div>
  );
}
