"use client";

import { Check, Loader2, Pencil, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { discardEmptyNote, getNote, saveNote } from "@/actions/documents";
import { clearDraft, noteDraftKey as draftKey, readDraft, writeDraft } from "@/components/board/draft-storage";
import { DescriptionField } from "@/components/ui/DescriptionField";
import { LazyMarkdown } from "@/components/ui/LazyMarkdown";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { loadWhenOnline, refreshWhenOnline } from "@/lib/connection";
import { isUntypedImage, NOTE_MAX_CHARS } from "@/lib/document-kind";
import { actionThrowResult } from "@/lib/stale-action";
import type { EditorModeValue, UserOption } from "@/lib/types";
import { NOTE_DRAFT_DELAY_MS, noteSaveDelay, noteSaveStop, noteStillStopped, type NoteSaveStop } from "./note-save";
import { uploadDocument } from "./uploadDocuments";

// Editor de una nota de Documentación (texto en la base, sin fichero): el mismo campo que las descripciones (modo visual o
// Markdown según el perfil, menciones, imágenes pegadas), con guardado automático y aviso de cambios simultáneos.
//
// Guardado: al rato de dejar de escribir (más cuanto más larga es la nota, noteSaveDelay), al pulsar «Listo», al ocultar la
// pestaña y al cerrar el visor. Cada guardado manda la versión que conocía; si la nota cambió entretanto (otra persona u
// otra pestaña), el servidor no pisa nada y devuelve la otra versión: el editor deja de guardar y pregunta. También deja
// de guardar ante lo que reintentar no arregla (la nota en la papelera, la cuota llena, el máximo de caracteres) y lo dice.
// Lo escrito y aún no guardado se copia en el navegador (borrador local, como el de las tareas) poco después de cada
// cambio y siempre al cerrar u ocultar: sin red, al recargar o si el cierre no llega a guardar, se recupera al volver.

/** Lo que se guarda como borrador: el texto y la versión del servidor sobre la que se escribió. */
interface NoteDraft {
  text: string;
  base: number;
}

type Status = "idle" | "pending" | "saving" | "saved" | "offline" | "error" | "conflict" | "stopped";

const isImage = (f: File) => f.type.startsWith("image/") || isUntypedImage(f.name, f.type);

interface Props {
  docId: string;
  projectId: string;
  currentUserId: string;
  editorMode: EditorModeValue;
  users: UserOption[];
  fileMaxMb: number;
  /** Abrir ya en modo edición (una nota recién creada). */
  startEditing?: boolean;
  /** Se guardó: el tamaño nuevo (bytes del texto) y, si el guardado le cambió el nombre (título automático), el nuevo. */
  onSaved?: (size: number, name?: string) => void;
  /** Se subió una imagen pegada como documento (la lista debe refrescarse). */
  onUploaded?: () => void;
  /** La nota resultó estar en la papelera (la mandó otra persona): la lista debe refrescarse. */
  onTrashed?: () => void;
  /** Recién creada con «Nueva nota»: si se cierra sin haber escrito nada, se descarta (no queda una nota vacía). */
  discardIfEmpty?: boolean;
  /** Se descartó la nota vacía al cerrar (la lista debe refrescarse). */
  onDiscarded?: () => void;
}

export function NoteEditor({ docId, projectId, currentUserId, editorMode, users, fileMaxMb, startEditing = false, onSaved, onUploaded, onTrashed, discardIfEmpty = false, onDiscarded }: Props) {
  const t = useT();
  const toast = useToast();
  const key = draftKey(currentUserId, docId);
  const [loaded, setLoaded] = useState<"loading" | "ready" | "error">("loading");
  const [trashed, setTrashed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // Cambia para volver a montar el editor con un texto que llega de fuera («Usar la otra»).
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; version: number } | null>(null);
  const [uploading, setUploading] = useState(0);
  // Por qué se paró el guardado (para pintar «Reintentar»); el valor de trabajo va en stopRef.
  const [stopReason, setStopReason] = useState<NoteSaveStop["reason"] | null>(null);
  const conflictBox = useRef<HTMLDivElement>(null);

  // Lo último escrito, lo que el servidor tiene (en `base`) y si hay un guardado en curso: refs, para el temporizador y el cierre.
  const textRef = useRef("");
  const savedRef = useRef("");
  const baseRef = useRef(0);
  const inflight = useRef(false);
  const again = useRef(false);
  const conflictRef = useRef(false);
  /** Guardado parado por un error que reintentar no arregla (ver noteSaveStop). */
  const stopRef = useRef<NoteSaveStop | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const callbacks = useRef({ onSaved, onUploaded, onTrashed, onDiscarded });
  const discardRef = useRef(discardIfEmpty);
  /** El texto del servidor ya se cargó (sin eso, «vacía» no se sabe). */
  const readyRef = useRef(false);
  useEffect(() => {
    callbacks.current = { onSaved, onUploaded, onTrashed, onDiscarded };
    discardRef.current = discardIfEmpty;
  });

  const dirty = () => textRef.current !== savedRef.current;
  // El guardado se vuelve a llamar a sí mismo (reintento, lo escrito mientras se guardaba): por aquí, siempre el último.
  const saveRef = useRef<() => Promise<void>>(async () => {});

  /** Copia ya al borrador local lo escrito (o lo borra si ya está guardado). */
  const flushDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (textRef.current === savedRef.current) clearDraft(key);
    else writeDraft(key, { text: textRef.current, base: baseRef.current } satisfies NoteDraft);
  }, [key]);

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), noteSaveDelay(textRef.current.length));
  };

  /** Deja de guardar solo y explica por qué (la papelera, además, sale del modo edición). */
  const stop = useCallback((why: NoteSaveStop, message: string) => {
    stopRef.current = why;
    flushDraft();
    if (!alive.current) return;
    setStopReason(why.reason);
    setStatus("stopped");
    setError(message);
    if (why.reason === "trashed") {
      setTrashed(true);
      setEditing(false);
      callbacks.current.onTrashed?.();
    }
  }, [flushDraft]);

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (conflictRef.current || stopRef.current) return;
    if (inflight.current) {
      again.current = true;
      return;
    }
    const sending = textRef.current;
    if (sending === savedRef.current) {
      clearDraft(key);
      if (alive.current) setStatus((s) => (s === "pending" || s === "offline" ? "saved" : s));
      return;
    }
    if (sending.length > NOTE_MAX_CHARS) {
      stop({ reason: "too_long" }, t("La nota supera el máximo de 200.000 caracteres. Quita texto o divídela en varias notas."));
      return;
    }
    inflight.current = true;
    if (alive.current) setStatus("saving");
    let offline = false;
    const res = await saveNote(docId, sending, baseRef.current).catch((e: unknown) => {
      offline = true;
      return actionThrowResult(e, t);
    });
    inflight.current = false;
    if (!res.ok) {
      const why = offline ? null : noteSaveStop("code" in res ? res.code : undefined, sending.length);
      if (why) stop(why, res.error);
      else if (offline) {
        // Sin red: lo escrito sigue en el borrador local y se envía al volver la conexión.
        flushDraft();
        refreshWhenOnline(() => void saveRef.current(), saveRef);
        if (alive.current) setStatus("offline");
      } else if (alive.current) {
        setStatus("error");
        setError(res.error);
      }
      return;
    }
    const out = res.data;
    if (out.status === "conflict") {
      // La otra versión es igual a lo escrito aquí (p. ej. este mismo texto desde otra pestaña): nada que elegir.
      if (out.content === textRef.current) {
        baseRef.current = out.version;
        savedRef.current = out.content;
        clearDraft(key);
        if (alive.current) setStatus("saved");
        return;
      }
      conflictRef.current = true;
      flushDraft();
      if (alive.current) {
        setConflict({ content: out.content, version: out.version });
        setStatus("conflict");
      }
      return;
    }
    baseRef.current = out.version;
    savedRef.current = sending;
    callbacks.current.onSaved?.(out.size, out.name);
    if (textRef.current === sending) {
      clearDraft(key);
      if (alive.current) {
        setStatus("saved");
        setError(null);
      }
    } else {
      flushDraft();
      if (alive.current) schedule();
    }
    if (again.current) {
      again.current = false;
      void saveRef.current();
    }
  }, [docId, key, t, stop, flushDraft]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Al abrir: el texto del servidor y, si hay un borrador local distinto, se recupera (o se avisa si la nota cambió desde entonces).
  useEffect(() => {
    return loadWhenOnline(
      () => getNote(docId),
      (res) => {
        if (!res.ok) {
          setLoaded("error");
          setError(res.error);
          return;
        }
        const { content, version } = res.data;
        savedRef.current = content;
        baseRef.current = version;
        setTrashed(res.data.trashed);
        const draft = res.data.trashed ? null : readDraft<NoteDraft>(key);
        if (draft && typeof draft.text === "string" && typeof draft.base === "number" && draft.text !== content) {
          textRef.current = draft.text;
          setText(draft.text);
          setEditing(true);
          if (draft.base === version) {
            setStatus("pending");
            schedule();
          } else {
            conflictRef.current = true;
            setConflict({ content, version });
            setStatus("conflict");
          }
        } else {
          if (draft) clearDraft(key);
          textRef.current = content;
          setText(content);
          setEditing(startEditing && !res.data.trashed);
        }
        readyRef.current = true;
        setLoaded("ready");
      },
      () => setLoaded("error"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir la nota
  }, [docId]);

  // Al ocultar la pestaña se guarda ya; al cerrar el visor, lo pendiente se envía. En los dos casos el borrador local se
  // escribe en el acto (por si el guardado no llega).
  useEffect(() => {
    alive.current = true;
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !dirty()) return;
      flushDraft();
      void save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onHide);
      if (dirty()) {
        flushDraft();
        void save();
      } else {
        if (timer.current) clearTimeout(timer.current);
        if (draftTimer.current) clearTimeout(draftTimer.current);
      }
    };
  }, [save, flushDraft]);

  // Solo al cerrar el visor (no cuando el efecto de arriba se repite): una nota nueva cerrada sin escribir nada (cargada, nunca
  // guardada, sin guardado en curso ni conflicto) se descarta. El servidor la borra solo si sigue vacía, sin guardar, sin
  // renombrar y sin fijar, así que no se pierde nada.
  useEffect(() => {
    return () => {
      if (!discardRef.current || !readyRef.current || inflight.current || conflictRef.current || stopRef.current) return;
      if (baseRef.current !== 0 || savedRef.current !== "" || textRef.current !== "") return;
      void discardEmptyNote(docId).then((r) => {
        if (r.ok && r.data.discarded) callbacks.current.onDiscarded?.();
      }).catch(() => {});
    };
  }, [docId]);

  // El aviso de cambio simultáneo se lleva el foco: quien usa el teclado o un lector de pantalla se entera y elige ahí.
  useEffect(() => {
    if (conflict) conflictBox.current?.focus();
  }, [conflict]);

  function change(value: string) {
    textRef.current = value;
    setText(value);
    // El borrador local, poco después (copiar el texto entero en cada tecla se notaba en notas largas).
    if (!draftTimer.current) draftTimer.current = setTimeout(flushDraft, NOTE_DRAFT_DELAY_MS);
    if (conflictRef.current) return;
    const stopped = stopRef.current;
    if (stopped) {
      if (noteStillStopped(stopped, value)) return;
      // Ya cabe (texto más corto): vuelve a guardar solo.
      stopRef.current = null;
      setStopReason(null);
      setError(null);
    }
    setStatus("pending");
    schedule();
  }

  /** «Reintentar» tras la cuota llena (p. ej. después de liberar espacio en otra pestaña). */
  function retry() {
    if (stopRef.current?.reason !== "quota") return;
    stopRef.current = null;
    setStopReason(null);
    setError(null);
    void save();
  }

  /** Pasar a editar: si no hay nada sin guardar, con el texto más reciente del servidor (otra persona pudo cambiarlo). */
  async function startEdit() {
    if (!dirty()) {
      const res = await getNote(docId).catch(() => null);
      if (res?.ok && !dirty()) {
        savedRef.current = res.data.content;
        baseRef.current = res.data.version;
        textRef.current = res.data.content;
        setText(res.data.content);
        setEditorKey((k) => k + 1);
        if (res.data.trashed) {
          setTrashed(true);
          callbacks.current.onTrashed?.();
          return;
        }
      }
    }
    setEditing(true);
  }

  async function finish() {
    await save();
    if (!conflictRef.current && !stopRef.current && !dirty()) setEditing(false);
  }

  /** Quedarse con lo escrito: se guarda encima de la otra versión. */
  function keepMine() {
    if (!conflict) return;
    baseRef.current = conflict.version;
    conflictRef.current = false;
    setConflict(null);
    flushDraft();
    void save();
  }

  /** Usar la otra versión: se descarta lo escrito aquí. */
  function useTheirs() {
    if (!conflict) return;
    baseRef.current = conflict.version;
    savedRef.current = conflict.content;
    textRef.current = conflict.content;
    conflictRef.current = false;
    setText(conflict.content);
    setEditorKey((k) => k + 1);
    setConflict(null);
    clearDraft(key);
    setStatus("saved");
  }

  /** Imágenes pegadas o soltadas: se suben a la Documentación del proyecto y se enlazan en la nota. */
  async function uploadImages(files: File[]) {
    const out: { id: string; name: string; src: string }[] = [];
    setUploading((n) => n + 1);
    try {
      for (const file of files.filter(isImage)) {
        const res = await uploadDocument(projectId, file, t, fileMaxMb);
        if (!res.ok) {
          toast(res.error, "error");
          continue;
        }
        if (res.document?.kind === "IMAGE") out.push({ id: res.document.id, name: res.document.name, src: `/api/documents/${res.document.id}` });
      }
    } finally {
      if (alive.current) setUploading((n) => n - 1);
    }
    if (out.length) callbacks.current.onUploaded?.();
    return out;
  }

  if (loaded === "loading") return <p className="py-10 text-center text-sm text-slate-500"><Loader2 size={18} className="mx-auto animate-spin" /></p>;
  if (loaded === "error") return <p className="py-10 text-center text-sm text-red-600">{error ?? t("No se pudo cargar el archivo.")}</p>;

  // Lo pasajero («Guardando…», «Guardado») no se anuncia: un lector de pantalla lo repetiría en cada pausa. Solo lo que
  // pide hacer algo (sin conexión, un error, el guardado parado), en su propia zona anunciada.
  const transient =
    uploading > 0 ? t("Subiendo imagen…")
    : status === "saving" ? t("Guardando…")
    : status === "pending" ? t("Sin guardar")
    : status === "saved" ? t("Guardado")
    : "";
  const alert =
    status === "offline" ? t("Sin conexión: lo escrito queda en este navegador y se guardará al volver la conexión.")
    : status === "error" || status === "stopped" ? (error ?? "")
    : "";

  return (
    <div className="space-y-3" data-testid="note-editor">
      {conflict && (
        <div
          ref={conflictBox} tabIndex={-1} role="alert" data-testid="note-conflict"
          className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <p className="font-medium">{t("Esta nota ha cambiado en otra pestaña o por otra persona mientras escribías. Lo tuyo aún no se ha guardado.")}</p>
          <details>
            <summary className="cursor-pointer">{t("Ver la otra versión")}</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-100">{conflict.content}</pre>
          </details>
          <span className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={keepMine}>{t("Quedarme con la mía")}</button>
            <button type="button" className="btn-secondary" onClick={useTheirs}>{t("Usar la otra")}</button>
          </span>
        </div>
      )}
      {editing ? (
        <DescriptionField
          key={editorKey}
          mode={editorMode}
          value={text}
          onValueChange={change}
          users={users}
          placeholder={t("Escribe la nota…")}
          autoFocus
          onFiles={uploadImages}
          textareaClassName="input field-sizing-content min-h-64 font-mono text-[13px]"
        />
      ) : text.trim() ? (
        <div data-testid="doc-markdown" onDoubleClick={trashed ? undefined : () => void startEdit()}><LazyMarkdown>{text}</LazyMarkdown></div>
      ) : (
        <p className="py-6 text-center text-sm text-slate-500">{trashed ? t("La nota está vacía.") : t("La nota está vacía. Pulsa «Editar» para escribir.")}</p>
      )}
      {trashed && status === "stopped" && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {!trashed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0" data-testid="note-status">
            {alert ? (
              <span className="text-xs text-red-600 dark:text-red-400" role="alert">{alert}</span>
            ) : (
              <span className="text-xs text-slate-500">{transient}</span>
            )}
          </span>
          <span className="flex gap-2">
            {status === "stopped" && stopReason === "quota" && (
              <button type="button" className="btn-secondary" onClick={retry}>
                <RotateCcw size={16} /> {t("Reintentar")}
              </button>
            )}
            {editing ? (
              <button type="button" className="btn-secondary" onClick={() => void finish()} disabled={uploading > 0}>
                <Check size={16} /> {t("Listo")}
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => void startEdit()} data-testid="note-edit">
                <Pencil size={16} /> {t("Editar")}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
