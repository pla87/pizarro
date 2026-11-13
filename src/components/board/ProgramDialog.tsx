"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileDown, FolderOpen, Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { todayIso } from "@/lib/dates";
import { appTimeZone } from "@/lib/format";
import type { BoardColumn } from "@/lib/types";
import { Modal } from "../ui/Modal";
import { useBoard, useTasks } from "./context";

type State =
  | { status: "form" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; url: string; filename: string; savedId: string | null; savedName: string | null; saveError: string | null };

const header = (res: Response, name: string) => {
  const raw = res.headers.get(name);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * «Publicar programa (PDF)» de una columna con rol «Programa»: cada tarjeta es una sesión. Genera el PDF (número, fecha,
 * título, descripción y, si se marca, responsable), lo ofrece para descargar o abrir y, si se marca, guarda una copia en
 * la Documentación del proyecto. La descarga es un enlace (no una descarga automática) para que funcione también en el
 * móvil y en la app instalada, como el informe PDF.
 */
export function ProgramDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const { project } = useBoard();
  const t = useT();
  const sessions = useTasks().filter((x) => x.columnId === column.id).length;
  const [withAssignee, setWithAssignee] = useState(false);
  const [save, setSave] = useState(true);
  const [state, setState] = useState<State>({ status: "form" });
  const urlRef = useRef<string | null>(null);
  const endpoint = (assignee: boolean) => `/api/projects/${project.id}/columns/${column.id}/program?assignee=${assignee ? 1 : 0}`;
  const docName = `${t("Programa")} – ${todayIso(appTimeZone())}.pdf`;

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const publish = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`${endpoint(withAssignee)}&save=${save ? 1 : 0}`, { method: "POST", cache: "no-store" });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).trim();
        throw new Error(res.status === 429 ? t("Demasiadas peticiones, espera un momento.") : text.length && text.length < 300 ? text : t("No se pudo generar el programa."));
      }
      const blob = await res.blob();
      const filename = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? docName;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setState({ status: "ready", url, filename, savedId: header(res, "X-Pizarro-Document-Id"), savedName: header(res, "X-Pizarro-Document-Name"), saveError: header(res, "X-Pizarro-Document-Error") });
    } catch (err) {
      setState({ status: "error", message: err instanceof TypeError ? t("Sin conexión: no se ha podido generar el programa.") : err instanceof Error ? err.message : t("No se pudo generar el programa.") });
    }
  };

  const busy = state.status === "loading";
  const footer =
    state.status === "ready" ? (
      <button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>
    ) : (
      <>
        <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
        <button type="button" className="btn-primary" onClick={() => void publish()} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} {t("Publicar")}
        </button>
      </>
    );

  return (
    <Modal open onClose={onClose} size="sm" title={t("Publicar programa (PDF)")} footer={footer}>
      {state.status === "ready" ? (
        <div className="space-y-3 text-sm" data-program-ready>
          <p className="text-slate-600 dark:text-slate-300">{t("El programa está listo.")}</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-primary" href={state.url} download={state.filename}>
              <FileDown size={16} /> {t("Descargar")}
            </a>
            <button type="button" className="btn-secondary" onClick={() => window.open(state.url, "_blank")}>{t("Abrir")}</button>
          </div>
          {state.savedId && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-emerald-700 dark:text-emerald-300" role="status">
              {t("Guardado en Documentación como «{name}».", { name: state.savedName ?? docName })}
              <Link className="inline-flex items-center gap-1 font-medium underline" href={`/p/${project.id}/docs?doc=${state.savedId}`}>
                <FolderOpen size={14} /> {t("Abrir Documentación")}
              </Link>
            </p>
          )}
          {state.saveError && (
            <p className="text-red-600 dark:text-red-400" role="alert">{t("No se ha guardado en Documentación: {reason}", { reason: state.saveError })}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            {sessions === 1
              ? t("Un PDF con la sesión de «{name}»: número, fecha, título y descripción.", { name: column.name })
              : t("Un PDF con las {n} sesiones de «{name}» en su orden: número, fecha, título y descripción.", { n: sessions, name: column.name })}
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={withAssignee} onChange={(e) => setWithAssignee(e.target.checked)} disabled={busy} />
            <span>{t("Incluir el responsable de cada sesión (profesor)")}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={save} onChange={(e) => setSave(e.target.checked)} disabled={busy} />
            <span>{t("Guardar también en Documentación como «{name}»", { name: docName })}</span>
          </label>
          <p>
            <a className="text-brand-600 underline dark:text-brand-300" href={endpoint(withAssignee)} target="_blank" rel="noopener">{t("Vista previa sin guardar")}</a>
          </p>
          {state.status === "error" && <p className="text-red-600 dark:text-red-400" role="alert">{state.message}</p>}
        </div>
      )}
    </Modal>
  );
}
