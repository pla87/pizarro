"use client";

import { ChevronUp, Loader2, Reply, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { addComment, deleteComment, getOlderComments } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { mentionsToPlain } from "@/lib/mentions";
import type { CommentInfo, TaskDetail, TaskLinkInfo, UserOption } from "@/lib/types";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../ui/Markdown";
import { MentionTextarea, type MentionCommand } from "../ui/MentionTextarea";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { actionThrowResult } from "@/lib/stale-action";

/** Comentarios de la tarea, con respuestas (un solo nivel: las respuestas salen sangradas bajo su comentario). */
export function Comments({ taskId, detail, setDetail, users, onGoogle }: {
  taskId: string;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  users: UserOption[];
  onGoogle: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const board = useBoard();
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentInfo | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const comments = detail?.comments ?? [];
  const older = detail?.olderComments ?? 0;
  // Respuestas por comentario raíz. Una respuesta cuyo comentario aún no se ha cargado sale suelta, con un aviso.
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  const loadOlder = async () => {
    const first = comments[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const res = await board.track(getOlderComments(taskId, { createdAt: first.createdAt, id: first.id })).catch((e) => actionThrowResult(e, t));
    setLoadingOlder(false);
    if (!res.ok) return toast(res.error, "error");
    setDetail((d) => {
      if (!d) return d;
      const have = new Set(d.comments.map((c) => c.id));
      return { ...d, comments: [...res.data.comments.filter((c) => !have.has(c.id)), ...d.comments], olderComments: res.data.olderComments };
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await board.track(addComment(taskId, body, replyTo?.id ?? null)).catch((e) => actionThrowResult(e, t));
    setSending(false);
    if (!res.ok) return toast(res.error, "error");
    setText("");
    setReplyTo(null);
    setDetail((d) => (d ? { ...d, comments: [...d.comments, res.data], commentCount: d.commentCount + 1 } : d));
    board.patchTask(taskId, (t) => ({ commentCount: t.commentCount + 1 }));
  };

  const remove = async (c: CommentInfo) => {
    if (!(await confirm({ title: t("Borrar comentario"), message: t("¿Borrar este comentario?"), confirmLabel: t("Borrar"), danger: true }))) return;
    const res = await board.track(deleteComment(c.id));
    if (!res.ok) return toast(res.error, "error");
    const { soft, removed } = res.data;
    setDetail((d) => {
      if (!d) return d;
      // Con respuestas, el comentario se queda como «Comentario borrado»; si no, desaparece (y su marcador, si era la última respuesta).
      if (soft) return { ...d, commentCount: Math.max(0, d.commentCount - 1), comments: d.comments.map((x) => (x.id === c.id ? { ...x, body: "", authorId: null, authorName: null, deleted: true } : x)) };
      const gone = new Set(removed);
      const unloaded = removed.filter((id) => id && !d.comments.some((x) => x.id === id)).length;
      return { ...d, commentCount: Math.max(0, d.commentCount - 1), olderComments: Math.max(0, d.olderComments - unloaded), comments: d.comments.filter((x) => !gone.has(x.id)) };
    });
    if (replyTo?.id === c.id) setReplyTo(null);
    board.patchTask(taskId, (t) => ({ commentCount: Math.max(0, t.commentCount - 1) }));
  };

  const renderComment = (c: CommentInfo) =>
    c.deleted ? (
      <div key={c.id} className="flex gap-2">
        <span className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <time className="text-xs text-slate-400">{formatDate(c.createdAt, "dateTimeShort", locale)}</time>
          <p className="mt-0.5 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm italic text-slate-400 dark:border-slate-700">{t("Comentario borrado")}</p>
        </div>
      </div>
    ) : (
    <div key={c.id} className="group flex gap-2">
      {c.authorId ? <Avatar id={c.authorId} name={c.authorName ?? "?"} /> : <span className="h-6 w-6" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-semibold">{c.authorName ?? t("Usuario eliminado")}</span>
          <time className="text-slate-400">{formatDate(c.createdAt, "dateTimeShort", locale)}</time>
          <span className="ml-auto flex items-center gap-3">
            <button
              className="inline-flex items-center gap-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-brand-600 focus-visible:opacity-100 max-md:opacity-100"
              onClick={() => {
                setReplyTo(c);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              <Reply size={12} /> {t("Responder")}
            </button>
            {c.authorId === board.currentUserId && (
              <button className="text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-600 max-md:opacity-100" onClick={() => remove(c)}>
                {t("Borrar")}
              </button>
            )}
          </span>
        </div>
        {c.parentId && !ids.has(c.parentId) && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><Reply size={11} /> {t("En respuesta a un comentario anterior")}</p>}
        <div className="mt-0.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <Markdown>{c.body}</Markdown>
        </div>
      </div>
    </div>
  );

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Comentarios")} {(detail?.commentCount ?? 0) > 0 && <span className="font-normal text-slate-500">{detail?.commentCount}</span>}</h3>
      {older > 0 && (
        <button type="button" className="btn-ghost mb-2 w-full justify-center py-1.5 text-xs" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? <Loader2 size={13} className="animate-spin" /> : <ChevronUp size={13} />} {t("Ver anteriores")} ({older})
        </button>
      )}
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
      <div className="mt-3 space-y-2">
        {replyTo && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-100">
            <Reply size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t("Respondiendo a {name}", { name: replyTo.authorName ?? t("Usuario eliminado") })}: {mentionsToPlain(replyTo.body).replace(/\s+/g, " ").slice(0, 80)}
            </span>
            <button type="button" className="shrink-0 hover:text-red-600" onClick={() => setReplyTo(null)} aria-label={t("Cancelar respuesta")}>
              <X size={14} />
            </button>
          </div>
        )}
        <MentionTextarea
          ref={input}
          className="input field-sizing-content min-h-16"
          value={text}
          onValueChange={setText}
          users={users}
          disabled={!detail}
          placeholder={t("Comenta… (@persona, @docs, @sheets)")}
          onCommand={async (kind) => {
            const link = await onGoogle(kind);
            if (link) setText((v) => `${v.trimEnd()} [${link.title.replace(/[\[\]]/g, "")}](${link.url}) `.trimStart());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={10000}
          aria-label={t("Nuevo comentario")}
        />
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-slate-400 max-sm:hidden">{t("Ctrl+Enter para enviar")}</span>
          <button className="btn-primary ml-auto py-1.5" onClick={send} disabled={sending || !text.trim()}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {replyTo ? t("Responder") : t("Comentar")}
          </button>
        </div>
      </div>
    </section>
  );
}
