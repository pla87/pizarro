"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/i18n/client";

interface Summary {
  projectId: string;
  name: string;
  counts: { columns: number; tasks: number; archivedTasks: number; comments: number; taskAttachments: number; releases: number; releaseAttachments: number; documents: number };
  unmappedUsers: { name: string; email: string }[];
  mappedUsers: number;
  addedMembers: number;
  warnings: string[];
}

/**
 * «Importar desde un archivo…» del diálogo de nuevo proyecto: sube un .pizarro.zip (el cuerpo de la petición es el
 * archivo, con barra de progreso) y enseña el resumen. `isPrivate` es lo que se ha elegido en el diálogo.
 */
export function ImportProjectPanel({ isPrivate, onBack, onClose }: { isPrivate: boolean; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const busy = progress !== null || processing;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    setError(null);
    setProgress(0);
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("POST", `/api/projects/import?private=${isPrivate ? 1 : 0}`);
    req.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    req.upload.onload = () => {
      setProgress(null);
      setProcessing(true);
    };
    req.onload = () => {
      setProgress(null);
      setProcessing(false);
      let body: { ok?: boolean; summary?: Summary; error?: string } = {};
      try {
        body = JSON.parse(req.responseText);
      } catch {
        // respuesta que no es JSON (p. ej. un proxy): se enseña el error genérico
      }
      if (req.status >= 200 && req.status < 300 && body.summary) {
        setSummary(body.summary);
        router.refresh();
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

  if (summary) {
    const c = summary.counts;
    return (
      <div className="space-y-4">
        <h3 className="font-semibold">{t("Proyecto importado")}</h3>
        <p className="text-sm">
          {t("«{name}» se ha creado con {tasks} tarjetas ({archived} archivadas), {columns} columnas, {comments} comentarios, {attachments} adjuntos, {releases} releases y {documents} documentos.", {
            name: summary.name, tasks: c.tasks, archived: c.archivedTasks, columns: c.columns, comments: c.comments, attachments: c.taskAttachments + c.releaseAttachments, releases: c.releases, documents: c.documents,
          })}
        </p>
        {summary.addedMembers > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{t("{n} usuario(s) se han añadido como miembros del proyecto por figurar en el archivo.", { n: summary.addedMembers })}</p>}
        {summary.unmappedUsers.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">{t("Personas sin emparejar ({n})", { n: summary.unmappedUsers.length })}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t("No hay un usuario activo con el mismo email (o el proyecto es privado), así que sus tarjetas quedan sin asignar y sus comentarios conservan el nombre original.")}</p>
            <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">
              {summary.unmappedUsers.map((u) => <li key={u.email}>{u.name} · {u.email}</li>)}
            </ul>
          </div>
        )}
        {summary.warnings.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">{t("Avisos")}</p>
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
        {t("Crea un proyecto nuevo a partir de un archivo .pizarro.zip exportado desde Pizarro. El nombre sale del archivo y las personas se emparejan por email con usuarios activos.")}
      </p>
      <div>
        <label className="label" htmlFor="import-file">{t("Archivo .pizarro.zip")}</label>
        <input
          id="import-file" ref={input} type="file" accept=".zip,application/zip" className="input" disabled={busy}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
        />
        <p className="mt-1 text-xs text-slate-500">{isPrivate ? t("Se creará como proyecto privado (solo tú lo verás).") : t("Se creará como proyecto de equipo.")}</p>
      </div>
      {progress !== null && (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("Subiendo…")} className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
          <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {processing && <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Loader2 size={15} className="animate-spin" /> {t("Procesando el archivo…")}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={processing} onClick={() => (progress !== null ? xhr.current?.abort() : onBack())}>{progress !== null ? t("Cancelar") : t("Volver")}</button>
        <button type="submit" className="btn-primary" disabled={!file || busy}>{t("Importar")}</button>
      </div>
    </form>
  );
}
