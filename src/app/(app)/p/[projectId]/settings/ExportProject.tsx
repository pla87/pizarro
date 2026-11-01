"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Attachments = "with" | "without";
type Scope = "board" | "all";
interface Estimate {
  tasks: number;
  archivedTasks: number;
  releases: number;
  documents: number;
  attachments: number;
  bytes: number;
}

/** Botón «Exportar proyecto» de los ajustes: pregunta adjuntos y alcance y descarga el .pizarro.zip. */
export function ExportProject({ projectId }: { projectId: string }) {
  const t = useT();
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

  const download = () => {
    const a = document.createElement("a");
    a.href = `/api/projects/${projectId}/export?${query}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(t("Preparando la descarga del proyecto…"));
    setOpen(false);
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
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <Download size={15} /> {t("Exportar proyecto")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("Exportar proyecto")} size="md">
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
              t("Se exportarán {tasks} tarjetas ({archived} archivadas), {releases} releases y {attachments} adjuntos (unos {size} MB).", {
                tasks: estimate.tasks, archived: estimate.archivedTasks, releases: estimate.releases, attachments: estimate.attachments, size: Math.max(0.1, Math.round((estimate.bytes / 1048576) * 10) / 10),
              })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t("Cancelar")}</button>
            <button type="button" className="btn-primary" onClick={download}>{t("Exportar")}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
