"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useIntlLocale, useT } from "@/i18n/client";
import { importSummaryItems } from "@/lib/import-summary";
import { personLine } from "@/lib/person-line";
import { announceQueued } from "./transfer/client";
import { TransferJobs } from "./transfer/TransferJobs";
import { TransferProgress } from "./transfer/TransferProgress";
import { useTransferJob } from "./transfer/useTransferJob";
import { useSafeRefresh } from "@/components/useSafeRefresh";

interface Summary {
  projectId: string;
  name: string;
  counts: { columns: number; tasks: number; archivedTasks: number; subtasks?: number; labels?: number; comments: number; notes?: number; taskAttachments: number; releases: number; releaseAttachments: number; documents: number };
  /** «trello» o «csv» si viene de otro Kanban; ausente o «pizarro» si es una exportación de Pizarro. */
  source?: "pizarro" | "trello" | "csv";
  unmappedUsers: { name: string; email: string }[];
  mappedUsers: number;
  addedMembers: number;
  warnings: string[];
}

/**
 * «Importar desde un archivo…» del diálogo de nuevo proyecto: sube un .pizarro.zip, un JSON de Trello o un CSV (el cuerpo
 * de la petición es el archivo, con barra de progreso; el servidor reconoce el formato por su contenido) y enseña el resumen. `isPrivate` es lo que se ha elegido en el diálogo.
 */
export function ImportProjectPanel({ isPrivate, privateToggle, onBack, onClose, onBusyChange }: { isPrivate: boolean; privateToggle: React.ReactNode; onBack: () => void; onClose: () => void; onBusyChange?: (busy: boolean) => void }) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const safeRefresh = useSafeRefresh();
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // La importación en sí es un trabajo en segundo plano: tras subir el archivo se sigue su progreso por su id.
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, gone } = useTransferJob(jobId, (done) => {
    setJobId(null);
    if (done.status === "DONE" && done.result && "counts" in done.result) {
      setSummary(done.result as Summary);
      safeRefresh();
    } else setError(done.error ?? t("No se pudo importar el proyecto."));
  });
  const busy = progress !== null || processing;
  // El diálogo avisa de que hay una importación en curso: mientras dure no se puede cerrar ni cambiar lo elegido.
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    setError(null);
    setProgress(0);
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("POST", `/api/projects/import?private=${isPrivate ? 1 : 0}&name=${encodeURIComponent(file.name.slice(0, 200))}`);
    req.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    req.upload.onload = () => {
      setProgress(null);
      setProcessing(true);
    };
    req.onload = () => {
      setProgress(null);
      setProcessing(false);
      let body: { ok?: boolean; jobId?: string; error?: string } = {};
      try {
        body = JSON.parse(req.responseText);
      } catch {
        // respuesta que no es JSON (p. ej. un proxy): se enseña el error genérico
      }
      if (req.status >= 200 && req.status < 300 && body.jobId) {
        setJobId(body.jobId);
        announceQueued();
      } else setError(body.error ?? t("No se pudo importar el proyecto."));
    };
    req.onerror = () => {
      setProgress(null);
      setProcessing(false);
      setError(t("Error de red al subir el archivo."));
    };
    req.onabort = () => {
      setProgress(null);
      setProcessing(false);
    };
    req.send(file);
  };

  if (jobId && !summary) {
    return (
      <div className="space-y-4" data-testid="import-progress">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Importando el proyecto en el servidor. Puedes cerrar esta ventana: te avisaremos cuando termine.")}</p>
        {gone ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("No se pudo importar el proyecto.")}</p> : job ? <TransferProgress job={job} /> : <p className="text-sm text-slate-500">{t("Procesando el archivo…")}</p>}
        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>
        </div>
      </div>
    );
  }

  if (summary) {
    const c = summary.counts;
    const foreign = summary.source === "trello" || summary.source === "csv";
    return (
      <div className="space-y-4" data-testid="import-summary">
        <h3 className="font-semibold">{t("Proyecto importado")}</h3>
        <p className="text-sm">{t("«{name}» se ha creado con {items}.", { name: summary.name, items: importSummaryItems(c, foreign, t, locale) })}</p>
        {(c.notes ?? 0) > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {c.notes === 1
              ? t("1 tarjeta lleva un comentario con quién la tenía asignada o la creó en el original, porque esa persona no está aquí.")
              : t("{n} tarjetas llevan un comentario con quién las tenía asignadas o las creó en el original, porque esas personas no están aquí.", { n: c.notes ?? 0 })}
          </p>
        )}
        {summary.addedMembers > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{foreign ? t("{n} usuario(s) se han añadido como miembros del proyecto por ser responsables de alguna tarea.", { n: summary.addedMembers }) : t("{n} usuario(s) se han añadido como miembros del proyecto por figurar en el archivo.", { n: summary.addedMembers })}</p>}
        {summary.unmappedUsers.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">{foreign ? t("Responsables sin emparejar ({n})", { n: summary.unmappedUsers.length }) : t("Personas sin emparejar ({n})", { n: summary.unmappedUsers.length })}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {foreign
                ? t("No hay un usuario activo con ese email o nombre (o el proyecto es privado), así que sus tareas quedan sin asignar y el nombre figura en la descripción.")
                : t("No hay un usuario activo con el mismo email (o el proyecto es privado), así que sus tarjetas quedan sin asignar y sus comentarios conservan el nombre original.")}
            </p>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">
              {summary.unmappedUsers.map((u) => <li key={`${u.name}|${u.email}`}>{personLine(u)}</li>)}
            </ul>
          </div>
        )}
        {summary.warnings.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">{foreign ? t("Cosas que no se pudieron importar") : t("Advertencias")}</p>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">
              {summary.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>
          <button type="button" className="btn-primary" onClick={() => { router.push(`/p/${summary.projectId}`); onClose(); }}>{t("Abrir proyecto")}</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Desde un .pizarro.zip de Pizarro, un JSON de Trello o un CSV de tareas.")}{" "}
        <InfoTip topic={t("Importar desde un archivo…")}>{t("CSV de Asana, Notion, GitHub Projects, Wekan, Kanboard… El formato se reconoce solo; las personas se emparejan por email o nombre y el nombre del proyecto sale del archivo.")}</InfoTip>
      </p>
      <div>
        <label className="label" htmlFor="import-file">{t("Archivo (.zip, .json o .csv)")}</label>
        <input
          id="import-file" ref={input} type="file" accept=".zip,.json,.csv,.tsv,.txt,application/zip,application/json,text/csv,text/plain" className="input" disabled={busy}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
        />
      </div>
      {privateToggle}
      {progress !== null && (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("Subiendo…")} className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {processing && <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Loader2 size={15} className="animate-spin" /> {t("Procesando el archivo…")}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-slate-500">{isPrivate ? t("Se creará como proyecto privado (solo tú lo verás).") : t("Se creará como proyecto de equipo.")}</p>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-secondary" disabled={processing} onClick={() => (progress !== null ? xhr.current?.abort() : onBack())}>{progress !== null ? t("Cancelar") : t("Volver")}</button>
          <button type="submit" className="btn-primary" disabled={!file || busy}>{t("Importar")}</button>
        </div>
      </div>
      <TransferJobs kind="IMPORT" title={t("Importaciones recientes (24 h)")} />
    </form>
  );
}
