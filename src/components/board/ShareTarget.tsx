"use client";

import { Loader2, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProjectFormData } from "@/actions/tasks";
import { useT } from "@/i18n/client";
import { shareTaskDescription, shareTaskTitle, SHARE_MAX_FILES, type SharedText, type ShareError } from "@/lib/share-core";
import { actionThrowMessage } from "@/lib/stale-action";
import type { EditorModeValue, ProjectFormData } from "@/lib/types";
import { lazyDialog } from "../lazyDialog";
import { useToast } from "../ui/Toast";
import { afterModalHistory } from "../ui/useBackToClose";
import { BoardContext } from "./context";
import type { NewTaskDraft } from "./drafts";
import { stubBoard } from "./stubBoard";

const NewTaskDialog = lazyDialog(() => import("./NewTaskDialog"), (m) => m.NewTaskDialog);

interface Props {
  /** Último proyecto usado (o el primero); null sin proyectos. */
  projectId: string | null;
  currentUserId: string;
  editorMode: EditorModeValue;
  /** Lo guardado por api/share (sus archivos se piden a api/share/<id>/<n>). */
  share: { id: string; files: { name: string; type: string; size: number }[] } | null;
  text: SharedText;
  /** Había un envío pero ya no está (caducó o se usó en otra pestaña). */
  expired: boolean;
  error: ShareError | null;
  /** Archivos que no se guardaron por llegar sin sesión. */
  lostFiles: number;
  /** Archivos que pasaban del tope por envío. */
  skippedFiles: number;
}

/** Borra lo compartido del servidor (al crear la tarea o descartarla). */
function dropShare(id: string): void {
  void fetch(`/api/share/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => {});
}

/**
 * «Compartir → Pizarro»: «Nueva tarea» (el diálogo de siempre, con selector de proyecto) con lo compartido. Los archivos
 * se suben a la tarea al crearla, por la ruta de siempre (límites del proyecto, cuota, deshacer con la creación).
 */
export function ShareTarget({ projectId, currentUserId, editorMode, share, text, expired, error, lostFiles, skippedFiles }: Props) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState<ProjectFormData | null>(null);
  const [files, setFiles] = useState<File[] | null>(share ? null : []);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const nothing = !share && !text.title && !text.text && !text.url;

  const messages: Record<ShareError, string> = {
    too_big: t("Lo compartido supera el tamaño máximo de una subida. Adjúntalo desde la tarea o compártelo en partes."),
    busy: t("Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos."),
    slow: t("La subida iba demasiado lenta y se ha cortado. Inténtalo de nuevo con mejor conexión."),
    rate: t("Has compartido demasiadas veces seguidas. Espera un momento."),
    failed: t("No se ha podido guardar lo compartido. Inténtalo de nuevo."),
    empty: t("No ha llegado nada que compartir."),
  };
  const problem = error ? messages[error] : expired ? t("Lo compartido ya no está disponible (se guarda 30 minutos). Vuelve a compartirlo.") : null;

  // Avisos de lo que no ha llegado (una vez).
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current) return;
    warned.current = true;
    if (problem && !nothing) toast(problem, "error");
    if (lostFiles > 0) toast(t("Sin sesión no se guardan los archivos compartidos ({n}). Vuelve a compartirlos ahora que has iniciado sesión.", { n: lostFiles }), "error");
    if (skippedFiles > 0) toast(t("Se admiten {max} archivos por envío: {n} no se han incluido.", { max: SHARE_MAX_FILES, n: skippedFiles }), "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Las opciones del proyecto y los archivos, a la vez.
  useEffect(() => {
    if (!projectId || nothing) return;
    let alive = true;
    getProjectFormData(projectId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setForm(res.data);
        else setFailed(res.error);
      })
      .catch((e) => alive && setFailed(actionThrowMessage(e, t)));
    if (share) {
      Promise.all(
        share.files.map(async (f, i) => {
          const res = await fetch(`/api/share/${encodeURIComponent(share.id)}/${i}`, { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          return new File([await res.blob()], f.name, { type: f.type });
        }),
      ).then(
        (list) => alive && setFiles(list),
        () => alive && setFailed(t("Lo compartido ya no está disponible (se guarda 30 minutos). Vuelve a compartirlo.")),
      );
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const api = useMemo(() => (form ? stubBoard(form, currentUserId, editorMode) : null), [form, currentUserId, editorMode]);
  const draft = useMemo<NewTaskDraft>(() => {
    const fromFile = share?.files[0]?.name.replace(/\.[^.]{1,8}$/, "") ?? "";
    return {
      title: shareTaskTitle(text) || fromFile,
      description: shareTaskDescription(text),
      kindId: "", columnId: "", assigneeId: "", dueDate: "", deliverableId: "", evergreen: false, subtasks: [], subtaskDraft: "",
    };
  }, [share, text]);

  // Proyecto al que ir al cerrar: el de la tarea creada (o el último elegido en el selector), no siempre el inicial.
  const [target, setTarget] = useState<string | null>(null);
  const close = (chosen: string) => {
    setTarget(chosen);
    setOpen(false);
    if (share) dropShare(share.id);
  };
  // Al tablero una vez cerrado el diálogo y retirada su entrada del historial (si no, ese «atrás» anulaba la navegación).
  useEffect(() => {
    const to = target ?? projectId;
    if (!open) afterModalHistory(() => router.replace(to ? `/p/${to}` : "/"));
  }, [open, projectId, target, router]);

  const panel = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-slate-300" data-share-page>
      <Share2 size={36} className="text-slate-300" />
      <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t("Compartir con Pizarro")}</h1>
      {body}
    </div>
  );

  if (!projectId) return panel(<p>{t("Todavía no tienes acceso a ningún proyecto.")}</p>);
  if (nothing || failed) {
    return panel(
      <>
        <p role="alert">{failed ?? problem ?? t("No ha llegado nada que compartir.")}</p>
        <Link href={`/p/${projectId}`} className="btn-secondary">{t("Ir al tablero")}</Link>
      </>,
    );
  }
  if (!api || !files) return panel(<p className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> {t("Preparando la nueva tarea…")}</p>);
  return (
    <>
      {panel(<p>{t("Elige el proyecto y crea la tarea con lo que has compartido.")}</p>)}
      {open && (
        <BoardContext.Provider value={api}>
          <NewTaskDialog pickProject initialFiles={files} draft={draft} onClose={close} />
        </BoardContext.Provider>
      )}
    </>
  );
}
