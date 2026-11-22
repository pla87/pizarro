"use client";

import { ArchiveRestore, CheckSquare, ChevronUp, Download, ExternalLink, FileText, Loader2, Reply, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { getOlderComments, getTaskDetail } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import { loadWhenOnline } from "@/lib/connection";
import { formatDate } from "@/lib/format";
import { formatSize } from "@/lib/format-size";
import { mentionsToPlain } from "@/lib/mentions";
import { actionThrowMessage, actionThrowResult } from "@/lib/stale-action";
import type { ArchivedTask, CommentInfo, TaskDetail } from "@/lib/types";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../ui/Markdown";
import { MentionText } from "../ui/MentionText";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";
import { TaskHistory } from "./TaskHistory";

/**
 * Tarea archivada en solo lectura (desde «Tareas archivadas»): título, descripción, subtareas, adjuntos, enlaces,
 * comentarios e historial, sin nada que editar. Para cambiarla hay que restaurarla («Restaurar», también aquí; el mismo verbo que la papelera de Documentación).
 * Es una vista propia y no el detalle de siempre en otro modo: el detalle guarda solo y todo él está pensado para editar.
 */
export function ArchivedTaskView({ task, onClose, onRestore, restoring }: {
  task: ArchivedTask;
  onClose: () => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const board = useBoard();
  const toast = useToast();
  const t = useT();
  const locale = useIntlLocale();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(
    () =>
      loadWhenOnline(
        () => getTaskDetail(task.id),
        (res) => {
          setError(res.ok ? null : res.error);
          if (res.ok) setDetail(res.data);
        },
        (err) => setError(actionThrowMessage(err, t)),
      ),
    [task.id, t],
  );

  const loadOlder = async () => {
    const first = detail?.comments[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const res = await getOlderComments(task.id, { createdAt: first.createdAt, id: first.id }).catch((e) => actionThrowResult(e, t));
    setLoadingOlder(false);
    if (!res.ok) return toast(res.error, "error");
    setDetail((d) => {
      if (!d) return d;
      const have = new Set(d.comments.map((c) => c.id));
      return { ...d, comments: [...res.data.comments.filter((c) => !have.has(c.id)), ...d.comments], olderComments: res.data.olderComments };
    });
  };

  const section = "space-y-2";
  const heading = "text-sm font-semibold";
  const comments = detail?.comments ?? [];
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const renderComment = (c: CommentInfo) => (
    <div className="flex gap-2" data-comment-id={c.id}>
      {c.authorId && !c.deleted ? <Avatar id={c.authorId} name={c.authorName ?? "?"} /> : <span className="h-6 w-6 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          {!c.deleted && <span className="font-semibold">{c.authorName ?? t("Usuario eliminado")}</span>}
          <time className="text-slate-400">{formatDate(c.createdAt, "dateTime", locale)}</time>
          {c.editedAt && !c.deleted && (
            <span className="text-slate-400" title={t("Editado el {date}", { date: formatDate(c.editedAt, "dateTime", locale) })}>{t("(editado)")}</span>
          )}
        </div>
        {c.parentId && !ids.has(c.parentId) && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><Reply size={11} /> {t("En respuesta a un comentario anterior")}</p>}
        {c.deleted ? (
          <p className="mt-0.5 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm italic text-slate-400 dark:border-slate-700">{t("Comentario borrado")}</p>
        ) : (
          <div className="mt-0.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60"><Markdown>{c.body}</Markdown></div>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      placement="top"
      ariaLabel={t("Tarea archivada: {title}", { title: mentionsToPlain(task.title) })}
      title={t("Detalle de la tarea archivada")}
      footer={
        <>
          <button className="btn-secondary ml-auto" onClick={onClose}>{t("Cerrar")}</button>
          <button className="btn-primary" onClick={onRestore} disabled={restoring}>
            {restoring ? <Loader2 size={15} className="animate-spin" /> : <ArchiveRestore size={15} />} {t("Restaurar")}
          </button>
        </>
      }
    >
      <div className="space-y-5" data-archived-view>
        <div className="space-y-1.5">
          {/* El título entero (la cabecera del diálogo lo cortaría a una línea). */}
          <p className="text-lg leading-snug font-semibold break-words"><MentionText text={task.title} /></p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <TypeBadge kind={board.kindById.get(task.kindId)} />
            <span>{t("Archivada el {date}", { date: formatDate(task.archivedAt, "date", locale) })}</span>
            <span>· {task.columnName ? t("de «{name}»", { name: task.columnName }) : t("columna borrada")}</span>
            {detail && (
              <span>
                ·{" "}
                {detail.createdByName
                  ? t("Creada por {name} el {date} a las {time}", { name: detail.createdByName, date: formatDate(detail.createdAt, "date", locale), time: formatDate(detail.createdAt, "timeHm", locale) })
                  : t("Creada el {date} a las {time}", { date: formatDate(detail.createdAt, "date", locale), time: formatDate(detail.createdAt, "timeHm", locale) })}
              </span>
            )}
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="note">
            {t("Tarea archivada: solo lectura. Restáurala para editarla o comentar.")}
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !detail ? (
          <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
        ) : (
          <>
            <section className={section}>
              <h3 className={heading}>{t("Descripción")}</h3>
              {detail.description.trim() ? <Markdown>{detail.description}</Markdown> : <p className="text-sm text-slate-500">{t("Sin descripción.")}</p>}
            </section>
            {detail.subtasks.length > 0 && (
              <section className={section}>
                <h3 className={heading}>{t("Subtareas")} <span className="font-normal text-slate-500">{detail.subtasks.filter((s) => s.done).length}/{detail.subtasks.length}</span></h3>
                <ul className="space-y-1 text-sm">
                  {detail.subtasks.map((s) => (
                    <li key={s.id} className="flex items-start gap-2">
                      {s.done ? <CheckSquare size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-label={t("Hecha")} /> : <Square size={16} className="mt-0.5 shrink-0 text-slate-400" aria-label={t("Pendiente")} />}
                      <span className={s.done ? "text-slate-500 line-through" : undefined}><MentionText text={s.title} /></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(detail.attachments.length > 0 || detail.links.length > 0) && (
              <section className={section}>
                <h3 className={heading}>{t("Adjuntos")}</h3>
                <ul className="space-y-1 text-sm">
                  {detail.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      {a.isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- miniatura servida por la app
                        <img src={`/api/attachments/${a.id}?thumb=1`} alt="" loading="lazy" className="h-8 w-12 shrink-0 rounded object-cover" />
                      ) : (
                        <FileText size={16} className="shrink-0 text-slate-400" />
                      )}
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.originalName}</a>
                      <span className="shrink-0 text-xs text-slate-400">{formatSize(a.size, locale)}</span>
                      <a href={`/api/attachments/${a.id}?download=1`} download={a.originalName} className="btn-icon h-7 w-7 shrink-0" aria-label={t("Descargar {name}", { name: a.originalName })} title={t("Descargar")}>
                        <Download size={14} />
                      </a>
                    </li>
                  ))}
                  {detail.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <ExternalLink size={16} className="shrink-0 text-slate-400" />
                      <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{l.title}</a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className={section}>
              <h3 className={heading}>{t("Comentarios")} {detail.commentCount > 0 && <span className="font-normal text-slate-500">{detail.commentCount}</span>}</h3>
              {detail.olderComments > 0 && (
                <button type="button" className="btn-ghost w-full justify-center py-1.5 text-xs" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? <Loader2 size={13} className="animate-spin" /> : <ChevronUp size={13} />} {t("Ver anteriores")} ({detail.olderComments})
                </button>
              )}
              {comments.length === 0 ? (
                <p className="text-sm text-slate-500">{t("Sin comentarios.")}</p>
              ) : (
                <ul className="space-y-3">
                  {roots.map((c) => {
                    const replies = repliesOf(c.id);
                    return (
                      <li key={c.id}>
                        {renderComment(c)}
                        {replies.length > 0 && (
                          <ul className="mt-2 ml-3 space-y-2 border-l-2 border-slate-200 pl-4 max-sm:ml-1 max-sm:pl-2 dark:border-slate-700">
                            {replies.map((r) => <li key={r.id}>{renderComment(r)}</li>)}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <TaskHistory taskId={task.id} />
          </>
        )}
      </div>
    </Modal>
  );
}
