"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useIntlLocale, useT } from "@/i18n/client";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { announceQueued } from "@/components/transfer/client";
import { TransferProgress } from "@/components/transfer/TransferProgress";
import { DownloadButton, TransferJobs } from "@/components/transfer/TransferJobs";
import { useTransferJob } from "@/components/transfer/useTransferJob";

type Attachments = "with" | "without";
type Scope = "board" | "all";
interface Estimate {
  tasks: number;
  archivedTasks: number;
  releases: number;
  documents: number;
  attachments: number;
  /** Lo que suman los adjuntos. */
  bytes: number;
  /** Lo demás: los datos del proyecto (project.json) y el envoltorio del ZIP. */
  dataBytes: number;
}

/** Progreso de una exportación en cola: se consulta cada 2 s y, al terminar, ofrece «Descargar». */
function ExportProgress({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const t = useT();
  const { job, gone } = useTransferJob(jobId);
  const result = job?.result;
  return (
    <div className="space-y-4" data-testid="export-progress">
      {job?.status === "DONE" ? (
        <p className="text-sm" role="status">{t("La exportación está lista. El archivo estará disponible 24 horas.")}</p>
      ) : job?.status === "FAILED" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{job.error ?? t("No se pudo exportar el proyecto.")}</p>
      ) : job?.status === "EXPIRED" || gone ? (
        <p className="text-sm">{t("El archivo ha caducado (24 h). Vuelve a exportar el proyecto.")}</p>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Preparando el archivo en el servidor. Puedes cerrar esta ventana: te avisaremos cuando esté listo.")}</p>
          {job ? <TransferProgress job={job} /> : <p className="text-sm text-slate-500">{t("Calculando…")}</p>}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>
        {job?.status === "DONE" && result && "size" in result && <DownloadButton id={job.id} size={result.size} />}
      </div>
    </div>
  );
}

/** Botón «Exportar proyecto» de los ajustes: pregunta adjuntos y alcance y prepara el .pizarro.zip en segundo plano. */
export function ExportProject({ projectId }: { projectId: string }) {
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachments>("with");
  const [scope, setScope] = useState<Scope>("board");
  const [loaded, setLoaded] = useState<{ query: string; value: Estimate | "error" } | null>(null);
  const query = `attachments=${attachments}&scope=${scope}`;
  // Solo vale el recuento de las opciones actuales; mientras llega el nuevo se enseña «Calculando…».
  const estimate = loaded?.query === query ? loaded.value : null;

  // Recuentos para que se sepa lo que se va a descargar (no leen ficheros: son baratos).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/export?${query}&estimate=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((e: Estimate) => !cancelled && setLoaded({ query, value: e }))
      .catch(() => !cancelled && setLoaded({ query, value: "error" }));
    return () => { cancelled = true; };
  }, [open, projectId, query]);

  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  /** Pone la exportación en cola y enseña su progreso; el archivo se prepara en el servidor y se descarga al terminar. */
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachments, scope }),
      });
      const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) {
        toast(body.error ?? t("No se pudo exportar el proyecto."), "error");
        return;
      }
      setJobId(body.jobId);
      announceQueued();
    } catch {
      toast(t("No se pudo exportar el proyecto."), "error");
    } finally {
      setBusy(false);
    }
  };

  const choice = (name: string, value: string, current: string, set: (v: never) => void, label: string, hint: string) => (
    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${current === value ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700"}`}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value as never)} className="mt-0.5" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <>
      <div className="space-y-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setJobId(null); setOpen(true); }}>
          <Download size={15} /> {t("Exportar proyecto")}
        </button>
        <TransferJobs kind="EXPORT" projectId={projectId} title={t("Exportaciones recientes (24 h)")} />
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t("Exportar proyecto")} size="md">
        {jobId ? <ExportProgress jobId={jobId} onClose={() => setOpen(false)} /> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Descarga el proyecto entero en un archivo .pizarro.zip. Sirve de copia de seguridad o para llevarlo a otra instalación de Pizarro (Nuevo proyecto → «Importar desde un archivo…»).")}
          </p>
          <fieldset className="space-y-2">
            <legend className="label">{t("Adjuntos")}</legend>
            {choice("export-attachments", "with", attachments, setAttachments, t("Con adjuntos"), t("Incluye los adjuntos de las tarjetas y de las releases y los archivos de Documentación. El archivo pesa más."))}
            {choice("export-attachments", "without", attachments, setAttachments, t("Sin adjuntos"), t("Solo los datos: rápido y ligero."))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="label">{t("Alcance")}</legend>
            {choice("export-scope", "board", scope, setScope, t("Solo el tablero"), t("Las tarjetas no archivadas, con sus subtareas y comentarios, más columnas, tipos, etiquetas y ajustes."))}
            {choice("export-scope", "all", scope, setScope, t("Todo el histórico"), t("Además, las tarjetas archivadas, las releases con su contenido y adjuntos, y el historial de cambios de las tarjetas."))}
          </fieldset>
          <p className="min-h-5 text-xs text-slate-500" aria-live="polite">
            {estimate === null && t("Calculando…")}
            {estimate === "error" && t("No se pudo calcular el tamaño.")}
            {estimate && estimate !== "error" &&
              t("Se exportarán {tasks} tarjetas ({archived} archivadas), {releases} releases y {attachments} adjuntos: un archivo de unos {size} MB.", {
                tasks: estimate.tasks, archived: estimate.archivedTasks, releases: estimate.releases, attachments: estimate.attachments,
                // Adjuntos más los datos (sin estos, un proyecto sin adjuntos prometía «unos 0,1 MB» y pesaba 0,6). Con la coma decimal del idioma.
                size: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.max(0.1, Math.round(((estimate.bytes + estimate.dataBytes) / 1048576) * 10) / 10)),
              })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t("Cancelar")}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={start}>{t("Exportar")}</button>
          </div>
        </div>
        )}
      </Modal>
    </>
  );
}
