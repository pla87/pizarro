"use client";

import { ChevronUp, Loader2, Pencil, Reply, Send, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { addComment, deleteComment, editComment, getOlderComments, getRecentComments } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import { isOffline, subscribeConnection } from "@/lib/connection";
import { formatDate } from "@/lib/format";
import { mentionsToPlain } from "@/lib/mentions";
import type { CommentInfo, TaskDetail, TaskLinkInfo, UserOption } from "@/lib/types";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../ui/Markdown";
import { MentionTextarea, type MentionCommand } from "../ui/MentionTextarea";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { purgeExpiredCommentDrafts, readCommentDraft, saveCommentDraft, type CommentDraft } from "./drafts";
import { REMOTE_CHANGE_EVENT, touchesComments, type RemoteChange } from "./remoteChange";
import { actionThrowResult } from "@/lib/stale-action";
import { isBefore, mergeComments, refreshCursor, type CommentCursor } from "./comment-list";

/** Igual que en el servidor (tasks.ts): el texto guardado, con las menciones completas. */
const MAX_COMMENT = 10_000;
/** Espera tras un aviso del canal en vivo antes de pedir los comentarios (se agrupan los seguidos). */
const LIVE_DELAY_MS = 250;

type ReplyTarget = NonNullable<CommentDraft["replyTo"]>;
const replyTargetOf = (c: CommentInfo): ReplyTarget => ({ id: c.id, authorName: c.authorName, body: c.body });

// Una vez por carga de la página: fuera los borradores de comentario caducados de cualquier tarea.
let purged = false;

/** Comentarios de la tarea, con respuestas (un solo nivel: las respuestas salen sangradas bajo su comentario). */
export function Comments({ taskId, detail, setDetail, users, onGoogle, editDirtyRef }: {
  taskId: string;
  detail: TaskDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<TaskDetail | null>>;
  users: UserOption[];
  onGoogle: (kind: MentionCommand) => Promise<TaskLinkInfo | null>;
  /** ¿Hay un comentario en edición con cambios sin guardar? (cerrar el detalle con él pide confirmación). */
  editDirtyRef?: React.MutableRefObject<(() => boolean) | null>;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const board = useBoard();
  const toast = useToast();
  const confirm = useConfirm();
  const me = board.currentUserId;
  const offline = useSyncExternalStore(subscribeConnection, isOffline, () => false);
  // Borrador local (por usuario y tarea): lo escrito y no enviado vuelve al abrir otra vez la tarea.
  const [initialDraft] = useState(() => {
    if (!purged) {
      purged = true;
      purgeExpiredCommentDrafts();
    }
    return readCommentDraft(me, taskId);
  });
  const [text, setTextState] = useState(initialDraft?.text ?? "");
  const [replyTo, setReplyToState] = useState<ReplyTarget | null>(initialDraft?.replyTo ?? null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const comments = detail?.comments ?? [];
  // Edición con cambios: el texto escrito difiere del guardado (sin contar espacios al principio o al final, como al guardar).
  const editDirtyLatest = useRef<() => boolean>(() => false);
  useEffect(() => {
    editDirtyLatest.current = () => {
      if (!editing) return false;
      const original = comments.find((c) => c.id === editing.id);
      return !!original && editing.text.trim() !== original.body;
    };
  });
  useEffect(() => {
    if (!editDirtyRef) return;
    editDirtyRef.current = () => editDirtyLatest.current();
    return () => {
      editDirtyRef.current = null;
    };
  }, [editDirtyRef]);
  const older = detail?.olderComments ?? 0;
  // Respuestas por comentario raíz. Una respuesta cuyo comentario aún no se ha cargado sale suelta, con un aviso.
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  // Cada cambio se guarda al momento: recargar o cerrar el detalle justo después no lo pierde.
  const draftRef = useRef<CommentDraft>({ text, replyTo });
  const persist = (next: CommentDraft) => {
    draftRef.current = next;
    saveCommentDraft(me, taskId, next);
  };
  const setText = (v: string | ((prev: string) => string)) => {
    const value = typeof v === "function" ? v(draftRef.current.text) : v;
    persist({ ...draftRef.current, text: value });
    setTextState(value);
  };
  const setReplyTo = (c: ReplyTarget | null) => {
    persist({ ...draftRef.current, replyTo: c });
    setReplyToState(c);
  };

  // --- Al día con los demás: el canal en vivo avisa de comentarios nuevos, editados o borrados en esta tarea. ---
  const detailRef = useRef(detail);
  useLayoutEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  // Cuenta los cambios propios en curso o recién hechos: un refresco que empezó antes no pisa lo que ya se ve.
  const localChanges = useRef(0);
  // Comentarios propios enviados que aún no han llegado en una lista del servidor (no sirven de cursor, ver refreshCursor).
  const unlisted = useRef(new Set<string>());
  // Pide un refresco (lo usa también «Enviar», con el cursor de antes de enviar).
  const requestRefresh = useRef<(delay: number, from?: CommentCursor | null) => void>(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const refresh = async (cursor?: CommentCursor | null) => {
      const d = detailRef.current;
      if (!d) return;
      const from = cursor !== undefined ? cursor : refreshCursor(d.comments, unlisted.current);
      const stamp = localChanges.current;
      const res = await getRecentComments(taskId, from).catch(() => null);
      if (!alive || !res?.ok) return;
      if (stamp !== localChanges.current) {
        // Mientras tanto se cambió algo aquí: se vuelve a pedir con lo de ahora.
        clearTimeout(timer);
        timer = setTimeout(refresh, LIVE_DELAY_MS);
        return;
      }
      // Lo enviado aquí antes de pedir ya está en la lista (o lo borró otra persona): desde ahora vale como cursor.
      unlisted.current.clear();
      setDetail((cur) => {
        if (!cur) return cur;
        // Lo anterior al cursor (cargado con «Ver anteriores» mientras tanto) se conserva; desde él manda el servidor.
        const kept = from ? cur.comments.filter((c) => isBefore(c, from)) : [];
        return {
          ...cur,
          comments: mergeComments(kept, res.data.comments),
          commentCount: res.data.commentCount,
          olderComments: kept.length ? cur.olderComments : res.data.olderComments,
        };
      });
      board.patchTask(taskId, () => ({ commentCount: res.data.commentCount }));
    };
    requestRefresh.current = (delay, from) => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(from), delay);
    };
    const onChange = (e: Event) => {
      if (!touchesComments((e as CustomEvent<RemoteChange>).detail, taskId)) return;
      requestRefresh.current(LIVE_DELAY_MS);
    };
    window.addEventListener(REMOTE_CHANGE_EVENT, onChange);
    return () => {
      alive = false;
      clearTimeout(timer);
      requestRefresh.current = () => {};
      window.removeEventListener(REMOTE_CHANGE_EVENT, onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  /** Envuelve un cambio propio (enviar, editar, borrar) para que un refresco en vivo a medias no lo deshaga. */
  const local = async <T,>(p: Promise<T>): Promise<T> => {
    localChanges.current++;
    try {
      return await p;
    } finally {
      localChanges.current++;
    }
  };

  const loadOlder = async () => {
    const first = comments[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const res = await board.track(getOlderComments(taskId, { createdAt: first.createdAt, id: first.id })).catch((e) => actionThrowResult(e, t));
    setLoadingOlder(false);
    if (!res.ok) return toast(res.error, "error");
    // Los que ya se tienen (p. ej. llegados en vivo) conservan su versión.
    setDetail((d) => (d ? { ...d, comments: mergeComments(res.data.comments, d.comments), olderComments: res.data.olderComments } : d));
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > MAX_COMMENT) return toast(t("El comentario es demasiado largo."), "error");
    setSending(true);
    // Desde dónde estaba al día antes de enviar: al terminar se recarga desde ahí, así llegan también los comentarios
    // que otras personas enviaron a la vez (anteriores al nuestro) aunque su aviso en vivo se cruce con el envío.
    const from = detailRef.current ? refreshCursor(detailRef.current.comments, unlisted.current) : null;
    const res = await local(board.track(addComment(taskId, body, replyTo?.id ?? null)).catch((e) => actionThrowResult(e, t)));
    setSending(false);
    // Si falla, el texto (y su borrador) se quedan para reintentar.
    if (!res.ok) return toast(res.error, "error");
    persist({ text: "", replyTo: null });
    setTextState("");
    setReplyToState(null);
    unlisted.current.add(res.data.id);
    // En su sitio por fecha (no al final): puede haber comentarios de otras personas posteriores que ya llegaron.
    setDetail((d) => (d ? { ...d, comments: mergeComments(d.comments, [res.data]), commentCount: d.commentCount + 1 } : d));
    board.patchTask(taskId, (t) => ({ commentCount: t.commentCount + 1 }));
    requestRefresh.current(0, from);
  };

  const remove = async (c: CommentInfo) => {
    if (!(await confirm({ title: t("Borrar comentario"), message: t("¿Borrar este comentario?"), confirmLabel: t("Borrar"), danger: true }))) return;
    const res = await local(board.track(deleteComment(c.id)));
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
    if (editing?.id === c.id) setEditing(null);
    board.patchTask(taskId, (t) => ({ commentCount: Math.max(0, t.commentCount - 1) }));
  };

  const saveEdit = async () => {
    if (!editing || savingEdit) return;
    const original = comments.find((c) => c.id === editing.id);
    const body = editing.text.trim();
    if (!body) return toast(t("El comentario está vacío."), "error");
    if (body.length > MAX_COMMENT) return toast(t("El comentario es demasiado largo."), "error");
    if (original && body === original.body) return setEditing(null);
    setSavingEdit(true);
    const res = await local(board.track(editComment(editing.id, body)).catch((e) => actionThrowResult(e, t)));
    setSavingEdit(false);
    // Si falla, la edición sigue abierta con lo escrito.
    if (!res.ok) return toast(res.error, "error");
    setDetail((d) => (d ? { ...d, comments: d.comments.map((x) => (x.id === res.data.id ? res.data : x)) } : d));
    setEditing(null);
  };

  const iconBtn = "text-slate-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100";

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
    <div key={c.id} className="group flex gap-2" data-comment-id={c.id}>
      {c.authorId ? <Avatar id={c.authorId} name={c.authorName ?? "?"} /> : <span className="h-6 w-6" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-semibold">{c.authorName ?? t("Usuario eliminado")}</span>
          <time className="text-slate-400">{formatDate(c.createdAt, "dateTimeShort", locale)}</time>
          {c.editedAt && (
            <span className="text-slate-400" title={t("Editado el {date}", { date: formatDate(c.editedAt, "dateTimeShort", locale) })}>
              {t("(editado)")}
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {c.authorId === me && editing?.id !== c.id && (
              <button
                type="button"
                className={`${iconBtn} -m-1 rounded p-1 hover:text-brand-600`}
                onClick={() => setEditing({ id: c.id, text: c.body })}
                aria-label={t("Editar comentario")}
                title={t("Editar comentario")}
              >
                <Pencil size={12} />
              </button>
            )}
            <button
              className={`${iconBtn} inline-flex items-center gap-0.5 hover:text-brand-600`}
              onClick={() => {
                setReplyTo(replyTargetOf(c));
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              <Reply size={12} /> {t("Responder")}
            </button>
            {c.authorId === me && (
              <button className={`${iconBtn} hover:text-red-600`} onClick={() => remove(c)}>
                {t("Borrar")}
              </button>
            )}
          </span>
        </div>
        {c.parentId && !ids.has(c.parentId) && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><Reply size={11} /> {t("En respuesta a un comentario anterior")}</p>}
        {editing?.id === c.id ? (
          <CommentEditor
            value={editing.text}
            onChange={(v) => setEditing((e) => (e && e.id === c.id ? { ...e, text: v } : e))}
            users={users}
            saving={savingEdit}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="mt-0.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <Markdown>{c.body}</Markdown>
          </div>
        )}
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
          pretty
          className="input field-sizing-content min-h-16"
          value={text}
          onValueChange={setText}
          users={users}
          disabled={!detail}
          // Sin el detalle (sin red al abrir la tarea) no se puede comentar: el campo lo dice en vez de parecer activo.
          placeholder={!detail && offline ? t("Sin conexión") : t("Comenta… (@persona, @docs, @sheets)")}
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
          maxLength={MAX_COMMENT}
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

/** Edición de un comentario propio en su sitio: Guardar (Ctrl/⌘+Enter) o Cancelar (Escape). */
function CommentEditor({ value, onChange, users, saving, onSave, onCancel }: {
  value: string;
  onChange: (value: string) => void;
  users: UserOption[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Al abrir, el cursor va al final del texto.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div className="mt-0.5 space-y-1.5">
      <MentionTextarea
        ref={ref}
        pretty
        className="input field-sizing-content min-h-16"
        value={value}
        onValueChange={onChange}
        users={users}
        maxLength={MAX_COMMENT}
        aria-label={t("Editar comentario")}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            // Cancela la edición sin cerrar el detalle.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto truncate text-xs text-slate-400 max-sm:hidden">{t("Ctrl+Enter para guardar · Escape para cancelar")}</span>
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={onCancel} disabled={saving}>
          {t("Cancelar")}
        </button>
        <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={onSave} disabled={saving || !value.trim()}>
          {saving && <Loader2 size={13} className="animate-spin" />} {t("Guardar")}
        </button>
      </div>
    </div>
  );
}
