"use client";

import { Check, Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNote, saveNote } from "@/actions/documents";
import { clearDraft, readDraft, writeDraft } from "@/components/board/draft-storage";
import { DescriptionField } from "@/components/ui/DescriptionField";
import { LazyMarkdown } from "@/components/ui/LazyMarkdown";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { loadWhenOnline, refreshWhenOnline } from "@/lib/connection";
import { isUntypedImage, NOTE_MAX_CHARS } from "@/lib/document-kind";
import { actionThrowResult } from "@/lib/stale-action";
import type { EditorModeValue, UserOption } from "@/lib/types";
import { uploadDocument } from "./uploadDocuments";

// Editor de una nota de Documentación (texto en la base, sin fichero): el mismo campo que las descripciones (modo visual o
// Markdown según el perfil, menciones, imágenes pegadas), con guardado automático y aviso de cambios simultáneos.
//
// Guardado: a los SAVE_DELAY_MS de dejar de escribir, al pulsar «Listo», al ocultar la pestaña y al cerrar el visor. Cada
// guardado manda la versión que conocía; si otra persona guardó entretanto, el servidor no pisa nada y devuelve la suya:
// el editor deja de guardar y pregunta (quedarse con la propia o usar la de la otra persona, que se puede ver antes).
// Lo escrito y aún no guardado se copia al momento en el navegador (borrador local, como el de las tareas): sin red, al
// recargar o si el cierre no llega a guardar, se recupera al volver a abrir la nota.

const SAVE_DELAY_MS = 1200;

/** Clave del borrador local de una nota (por persona y nota). */
const draftKey = (userId: string, docId: string) => `pz-draft-note:${userId}:${docId}`;

/** Lo que se guarda como borrador: el texto y la versión del servidor sobre la que se escribió. */
interface NoteDraft {
  text: string;
  base: number;
}

type Status = "idle" | "pending" | "saving" | "saved" | "offline" | "error" | "conflict";

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
  /** Se guardó: el tamaño nuevo (bytes del texto). */
  onSaved?: (size: number) => void;
  /** Se subió una imagen pegada como documento (la lista debe refrescarse). */
  onUploaded?: () => void;
}

export function NoteEditor({ docId, projectId, currentUserId, editorMode, users, fileMaxMb, startEditing = false, onSaved, onUploaded }: Props) {
  const t = useT();
  const toast = useToast();
  const key = draftKey(currentUserId, docId);
  const [loaded, setLoaded] = useState<"loading" | "ready" | "error">("loading");
  const [trashed, setTrashed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // Cambia para volver a montar el editor con un texto que llega de fuera («Usar la suya»).
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; version: number } | null>(null);
  const [uploading, setUploading] = useState(0);

  // Lo último escrito, lo que el servidor tiene (en `base`) y si hay un guardado en curso: refs, para el temporizador y el cierre.
  const textRef = useRef("");
  const savedRef = useRef("");
  const baseRef = useRef(0);
  const inflight = useRef(false);
  const again = useRef(false);
  const conflictRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const callbacks = useRef({ onSaved, onUploaded });
  useEffect(() => {
    callbacks.current = { onSaved, onUploaded };
  });

  const dirty = () => textRef.current !== savedRef.current;
  // El guardado se vuelve a llamar a sí mismo (reintento, lo escrito mientras se guardaba): por aquí, siempre el último.
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (conflictRef.current) return;
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
      if (alive.current) {
        setStatus("error");
        setError(t("La nota supera el máximo de 200.000 caracteres. Quita texto o divídela en varias notas."));
      }
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
      if (offline) {
        // Sin red: lo escrito sigue en el borrador local y se envía al volver la conexión.
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
      conflictRef.current = true;
      if (alive.current) {
        setConflict({ content: out.content, version: out.version });
        setStatus("conflict");
      }
      return;
    }
    baseRef.current = out.version;
    savedRef.current = sending;
    callbacks.current.onSaved?.(out.size);
    if (textRef.current === sending) {
      clearDraft(key);
      if (alive.current) {
        setStatus("saved");
        setError(null);
      }
    } else {
      writeDraft(key, { text: textRef.current, base: baseRef.current } satisfies NoteDraft);
      if (alive.current) timer.current = setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
    }
    if (again.current) {
      again.current = false;
      void saveRef.current();
    }
  }, [docId, key, t]);
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
            timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
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
        setLoaded("ready");
      },
      () => setLoaded("error"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir la nota
  }, [docId]);

  // Al ocultar la pestaña se guarda ya; al cerrar el visor, lo pendiente se envía (el borrador local queda por si no llega).
  useEffect(() => {
    alive.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirty()) void save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onHide);
      if (dirty()) void save();
      else if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);

  function change(value: string) {
    textRef.current = value;
    setText(value);
    writeDraft(key, { text: value, base: baseRef.current } satisfies NoteDraft);
    if (conflictRef.current) return;
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
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
      }
    }
    setEditing(true);
  }

  async function finish() {
    await save();
    if (!conflictRef.current && !dirty()) setEditing(false);
  }

  /** Quedarse con lo escrito: se guarda encima de la versión de la otra persona. */
  function keepMine() {
    if (!conflict) return;
    baseRef.current = conflict.version;
    conflictRef.current = false;
    setConflict(null);
    writeDraft(key, { text: textRef.current, base: baseRef.current } satisfies NoteDraft);
    void save();
  }

  /** Usar la versión de la otra persona: se descarta lo escrito aquí. */
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

  const statusText =
    uploading > 0 ? t("Subiendo imagen…")
    : status === "saving" ? t("Guardando…")
    : status === "pending" ? t("Sin guardar")
    : status === "saved" ? t("Guardado")
    : status === "offline" ? t("Sin conexión: lo escrito queda en este navegador y se guardará al volver la conexión.")
    : status === "error" ? (error ?? "")
    : "";

  return (
    <div className="space-y-3" data-testid="note-editor">
      {conflict && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" data-testid="note-conflict">
          <p className="font-medium">{t("Otra persona ha cambiado esta nota mientras escribías. Lo tuyo aún no se ha guardado.")}</p>
          <details>
            <summary className="cursor-pointer">{t("Ver su versión")}</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-100">{conflict.content}</pre>
          </details>
          <span className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={keepMine}>{t("Quedarme con la mía")}</button>
            <button type="button" className="btn-secondary" onClick={useTheirs}>{t("Usar la suya")}</button>
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
      {!trashed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={status === "error" || status === "offline" ? "text-xs text-red-600 dark:text-red-400" : "text-xs text-slate-500"} aria-live="polite" data-testid="note-status">
            {statusText}
          </span>
          {editing ? (
            <button type="button" className="btn-secondary" onClick={() => void finish()} disabled={uploading > 0}>
              <Check size={16} /> {t("Listo")}
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => void startEdit()} data-testid="note-edit">
              <Pencil size={16} /> {t("Editar")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
