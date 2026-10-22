"use client";

import { Loader2, Reply, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { addComment, deleteComment } from "@/actions/tasks";
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
  const input = useRef<HTMLTextAreaElement>(null);
  const comments = detail?.comments ?? [];
  // Respuestas por comentario raíz; una respuesta cuyo comentario ya no existe sale como comentario normal.
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await board.track(addComment(taskId, body, replyTo?.id ?? null)).catch(() => ({ ok: false as const, error: t("Error inesperado. Inténtalo de nuevo.") }));
    setSending(false);
    if (!res.ok) return toast(res.error, "error");
    setText("");
    setReplyTo(null);
    setDetail((d) => (d ? { ...d, comments: [...d.comments, res.data] } : d));
    board.patchTask(taskId, (t) => ({ commentCount: t.commentCount + 1 }));
  };

  const remove = async (c: CommentInfo) => {
    if (!(await confirm({ title: t("Borrar comentario"), message: t("¿Borrar este comentario?"), confirmLabel: t("Borrar"), danger: true }))) return;
    const res = await board.track(deleteComment(c.id));
    if (!res.ok) return toast(res.error, "error");
    // Sus respuestas pasan a ser comentarios de primer nivel (el servidor las desvincula).
    setDetail((d) => (d ? { ...d, comments: d.comments.filter((x) => x.id !== c.id).map((x) => (x.parentId === c.id ? { ...x, parentId: null } : x)) } : d));
    if (replyTo?.id === c.id) setReplyTo(null);
    board.patchTask(taskId, (t) => ({ commentCount: Math.max(0, t.commentCount - 1) }));
  };

  const renderComment = (c: CommentInfo) => (
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
        <div className="mt-0.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <Markdown>{c.body}</Markdown>
        </div>
      </div>
    </div>
  );

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Comentarios")} {comments.length > 0 && <span className="font-normal text-slate-500">{comments.length}</span>}</h3>
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
