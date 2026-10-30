"use client";

import { AlertCircle, ArrowLeft, Download, Eye, File as FileIcon, FileCode, FileImage, FileText, FileType, Loader2, Pencil, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { deleteDocument, deleteDocumentForever, renameDocument, restoreDocument } from "@/actions/documents";
import { filesFrom, formatBytes, useFileDrop } from "@/components/board/upload";
import { uploadDocument, documentUploadName } from "@/components/docs/uploadDocuments";
import { useDocTaskDialogs } from "@/components/docs/useDocTaskDialogs";
import { ZoomImage } from "@/components/docs/ZoomImage";
import { Markdown } from "@/components/ui/Markdown";
import { MODAL_SIZE_REM, Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { useIntlLocale, useT } from "@/i18n/client";
import { DOCUMENT_PREVIEW_MAX_BYTES, DOCUMENT_TRASH_DAYS, isPreviewable, type DocumentKindName } from "@/lib/document-kind";
import type { DocumentRow, TrashedDocumentRow } from "@/lib/documents";
import type { EditorModeValue } from "@/lib/types";
import { formatDate } from "@/lib/format";

interface Props {
  projectId: string;
  projectName: string;
  documents: DocumentRow[];
  trashed: TrashedDocumentRow[];
  fileMaxMb: number;
  maxCount: number;
  currentUserId: string;
  editorMode: EditorModeValue;
  /** Documento que se abre al entrar (enlace `?doc=`). */
  initialOpenId?: string | null;
}

interface UploadItem {
  key: number;
  name: string;
  status: "uploading" | "error";
  error?: string;
}

const ICONS: Record<DocumentKindName, { icon: typeof FileIcon; className: string }> = {
  TEXT: { icon: FileText, className: "text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-300" },
  MARKDOWN: { icon: FileCode, className: "text-sky-600 bg-sky-50 dark:bg-sky-500/15 dark:text-sky-300" },
  PDF: { icon: FileType, className: "text-red-600 bg-red-50 dark:bg-red-500/15 dark:text-red-300" },
  IMAGE: { icon: FileImage, className: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300" },
  OTHER: { icon: FileIcon, className: "text-slate-400 bg-slate-100 dark:bg-slate-800 dark:text-slate-400" },
};

/** Minúsculas y sin tildes, para que el buscador no distinga «Guía» de «guia». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let nextKey = 1;

export function DocsManager({ projectId, projectName, documents, trashed, fileMaxMb, maxCount, currentUserId, editorMode, initialOpenId = null }: Props) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [showTrash, setShowTrash] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  // Cola de subida en serie: cada archivo es una petición y el servidor aplica sus límites a cada una.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const kindLabel = (k: DocumentKindName) =>
    k === "TEXT" ? t("Texto") : k === "MARKDOWN" ? "Markdown" : k === "PDF" ? "PDF" : k === "IMAGE" ? t("Imagen") : t("Otro");

  function uploadFiles(files: File[]) {
    if (!files.length) return;
    let pending = files.length;
    let done = 0;
    for (const file of files) {
      const key = nextKey++;
      const name = documentUploadName(file, t);
      setUploads((u) => [...u, { key, name, status: "uploading" }]);
      const send = async () => {
        const res = await uploadDocument(projectId, file, t, fileMaxMb);
        if (!res.ok) return setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error", error: res.error } : x)));
        setUploads((u) => u.filter((x) => x.key !== key));
        done++;
      };
      queue.current = queue.current.then(send).then(() => {
        // Al terminar la tanda se refresca la lista y se avisa una sola vez.
        if (--pending > 0) return;
        router.refresh();
        if (done > 0) toast(done === 1 ? t("Documento subido") : t("{n} documentos subidos", { n: done }));
      });
    }
  }

  const dragging = useFileDrop(uploadFiles);

  // Pegar (Ctrl+V) archivos o capturas en cualquier punto de la página, salvo escribiendo en un campo de texto.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, [contenteditable='true']") || document.querySelector("[role=dialog]")) return;
      const files = filesFrom(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      uploadFiles(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const needle = fold(query.trim());
  const shown = needle ? documents.filter((d) => fold(d.name).includes(needle)) : documents;
  const open = documents.find((d) => d.id === openId) ?? null;
  const openTrashed = trashed.find((d) => d.id === openId) ?? null;
  const full = documents.length >= maxCount;

  async function restore(d: DocumentRow) {
    setBusyId(d.id);
    const res = await restoreDocument(d.id);
    setBusyId(null);
    if (!res.ok) return toast(res.error, "error");
    setOpenId(null);
    toast(t("Documento restaurado"));
    router.refresh();
  }

  async function removeForever(d: DocumentRow) {
    const ok = await confirm({
      title: t("Borrar definitivamente"),
      message: t("¿Borrar «{name}» definitivamente? No se puede deshacer.", { name: d.name }),
      confirmLabel: t("Borrar definitivamente"),
      danger: true,
    });
    if (!ok) return;
    setBusyId(d.id);
    const res = await deleteDocumentForever(d.id);
    setBusyId(null);
    if (!res.ok) return toast(res.error, "error");
    setOpenId(null);
    toast(t("Documento borrado definitivamente"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("Documentación")}</h1>
        <span className="flex flex-wrap items-center gap-2">
          {(trashed.length > 0 || showTrash) && (
            <button type="button" className="btn-secondary" aria-pressed={showTrash} data-testid="docs-trash-toggle" onClick={() => setShowTrash((v) => !v)}>
              {showTrash ? <ArrowLeft size={16} /> : <Trash2 size={16} />} {showTrash ? t("Volver a la documentación") : t("Papelera ({n})", { n: trashed.length })}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => fileInput.current?.click()} disabled={full}>
            <Upload size={16} /> {t("Subir archivos")}
          </button>
        </span>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          data-testid="docs-file-input"
          aria-label={t("Subir archivos")}
          tabIndex={-1}
          onChange={(e) => {
            uploadFiles(filesFrom(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      <p className="mb-4 text-sm text-slate-500">
        {t("Archivos de «{name}» para consultar sin salir de la app: {count} de {max} · máximo {mb} MB por archivo.", { name: projectName, count: documents.length, max: maxCount, mb: fileMaxMb })}
      </p>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-brand-500/10 backdrop-blur-[1px]" aria-hidden>
          <div className="rounded-xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-sm font-medium text-brand-700 dark:bg-slate-900/90 dark:text-brand-100">
            {t("Suelta los archivos para subirlos")}
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mb-4 space-y-1.5" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className={cn("card flex items-center gap-2 px-3 py-2 text-sm", u.status === "error" && "border-red-300 dark:border-red-500/50")}>
              {u.status === "uploading" ? <Loader2 size={16} className="shrink-0 animate-spin text-slate-400" /> : <AlertCircle size={16} className="shrink-0 text-red-500" />}
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.status === "uploading" ? (
                <span className="shrink-0 text-xs text-slate-500">{t("Subiendo…")}</span>
              ) : (
                <>
                  <span className="min-w-0 shrink text-xs text-red-600 dark:text-red-400" role="alert">{u.error}</span>
                  <button type="button" className="btn-icon shrink-0" aria-label={t("Descartar")} onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))}>
                    <X size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {showTrash ? (
        <section aria-label={t("Papelera")} data-testid="docs-trash">
          <p className="mb-3 text-sm text-slate-500">
            {t("Los documentos borrados se conservan {days} días y después se eliminan para siempre. Mientras tanto siguen contando en el espacio del proyecto.", { days: DOCUMENT_TRASH_DAYS })}
          </p>
          {trashed.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">{t("La papelera está vacía.")}</p>
          ) : (
            <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800" data-testid="docs-trash-list">
              {trashed.map((d) => {
                const { icon: Icon, className } = ICONS[d.kind];
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid="docs-trash-item">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", className)} title={kindLabel(d.kind)}>
                      <Icon size={18} aria-hidden />
                      <span className="sr-only">{kindLabel(d.kind)}</span>
                    </span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-sm font-medium">{d.name}</span>
                      <span className="block text-xs text-slate-500">
                        {formatBytes(d.size, locale)} · {t("Borrado por {name} el {date}", { name: d.deletedByName ?? t("Usuario eliminado"), date: formatDate(d.deletedAt, "dateNumeric", locale) })} ·{" "}
                        {d.daysLeft === 0 ? t("se elimina hoy") : d.daysLeft === 1 ? t("queda 1 día") : t("quedan {n} días", { n: d.daysLeft })}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button type="button" className="btn-secondary" onClick={() => setOpenId(d.id)} disabled={busyId === d.id}>
                        <Eye size={16} /> {t("Ver")}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void restore(d)} disabled={busyId === d.id}>
                        <RotateCcw size={16} /> {t("Restaurar")}
                      </button>
                      <button type="button" className="btn-danger" onClick={() => void removeForever(d)} disabled={busyId === d.id}>
                        <Trash2 size={16} /> {t("Borrar definitivamente")}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : documents.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500">
          <FileText size={32} className="text-slate-300" />
          <p className="max-w-md">
            {t("Aquí van los archivos de referencia del proyecto: guías y notas en texto o Markdown, PDF de especificaciones o contratos, capturas e imágenes. Arrastra archivos a esta página, pégalos o usa «Subir archivos». Todo el equipo del proyecto los puede ver y descargar.")}
          </p>
          <button type="button" className="btn-secondary mt-2" onClick={() => fileInput.current?.click()}>
            <Upload size={16} /> {t("Subir archivos")}
          </button>
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder={t("Buscar por nombre…")}
              aria-label={t("Buscar documentos")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">{t("Ningún documento coincide con «{query}».", { query })}</p>
          ) : (
            <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800" data-testid="docs-list">
              {shown.map((d) => {
                const { icon: Icon, className } = ICONS[d.kind];
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:bg-slate-50 dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60"
                      onClick={() => setOpenId(d.id)}
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", className)} title={kindLabel(d.kind)}>
                        <Icon size={18} aria-hidden />
                        <span className="sr-only">{kindLabel(d.kind)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {formatBytes(d.size, locale)} · {d.createdByName ?? t("Usuario eliminado")} · {formatDate(d.createdAt, "dateNumeric", locale)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {open && !showTrash && <DocViewer key={open.id} doc={open} projectId={projectId} currentUserId={currentUserId} editorMode={editorMode} onClose={() => setOpenId(null)} />}
      {openTrashed && showTrash && (
        <TrashViewer key={openTrashed.id} doc={openTrashed} busy={busyId === openTrashed.id} onClose={() => setOpenId(null)} onRestore={() => void restore(openTrashed)} />
      )}
    </div>
  );
}

/** Visor en un modal: imagen, PDF del visor del navegador, texto plano o Markdown; el resto solo se descarga. */
function DocViewer({ doc, projectId, currentUserId, editorMode, onClose }: { doc: DocumentRow; projectId: string; currentUserId: string; editorMode: EditorModeValue; onClose: () => void }) {
  const t = useT();
  const locale = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(doc.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.name);
  const [busy, setBusy] = useState(false);
  const src = `/api/documents/${doc.id}`;
  const big = doc.kind === "PDF" || doc.kind === "IMAGE";
  const second = useDocTaskDialogs({ projectId, currentUserId, editorMode, doc: { id: doc.id, name }, viewerWidth: MODAL_SIZE_REM[big ? "2xl" : "xl"] });
  // PDF e imágenes: visor grande, casi a toda la altura; deja margen a los lados para los botones y el diálogo de al lado.

  async function remove() {
    setBusy(true);
    const res = await deleteDocument(doc.id);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Documento enviado a la papelera"), "undo", {
      label: t("Deshacer"),
      onClick: () => {
        void restoreDocument(doc.id).then((r) => {
          if (!r.ok) return toast(r.error, "error");
          toast(t("Documento restaurado"));
          router.refresh();
        });
      },
    });
    onClose();
    router.refresh();
  }

  async function rename() {
    const next = draft.trim();
    if (!next || next === name) return setEditing(false);
    setBusy(true);
    const res = await renameDocument(doc.id, next);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setName(res.data.name);
    setEditing(false);
    router.refresh();
  }

  return (
    <>
    <Modal
      open
      onClose={onClose}
      size={big ? "2xl" : "xl"}
      panelClassName={big ? "h-[92dvh] sm:h-[calc(100dvh-2rem)] sm:max-h-none" : undefined}
      side={second.open ? "left" : "center"}
      pairLeftWidth={MODAL_SIZE_REM[big ? "2xl" : "xl"]}
      onAddSecond={second.open ? undefined : second.onAddSecond}
      onAddSecondBulk={second.open ? undefined : second.onAddSecondBulk}
      mobileAdd
      title={
        editing ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input className="input" value={draft} maxLength={120} autoFocus aria-label={t("Nombre del documento")} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={busy}>{t("Guardar")}</button>
            <button type="button" className="btn-secondary" onClick={() => { setEditing(false); setDraft(name); }}>{t("Cancelar")}</button>
          </form>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{name}</span>
            <button type="button" className="btn-icon shrink-0" aria-label={t("Renombrar")} title={t("Renombrar")} onClick={() => { setDraft(name); setEditing(true); }}>
              <Pencil size={14} />
            </button>
          </span>
        )
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {formatBytes(doc.size, locale)} · {doc.createdByName ?? t("Usuario eliminado")} · {formatDate(doc.createdAt, "dateNumeric", locale)}
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={16} /> {t("Borrar")}
            </button>
            <a className="btn-primary" href={`${src}?download=1`} download>
              <Download size={16} /> {t("Descargar")}
            </a>
          </span>
        </div>
      }
    >
      <DocPreview doc={doc} name={name} src={src} />
    </Modal>
    {second.dialogs}
    </>
  );
}

function DocPreview({ doc, name, src }: { doc: DocumentRow; name: string; src: string }) {
  const t = useT();
  const textKind = doc.kind === "TEXT" || doc.kind === "MARKDOWN";
  const tooBig = textKind && doc.size > DOCUMENT_PREVIEW_MAX_BYTES;
  const [loaded, setLoaded] = useState<{ id: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!textKind || tooBig) return;
    let cancelled = false;
    fetch(src)
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null)
      .then((text) => { if (!cancelled) setLoaded({ id: doc.id, text }); });
    return () => { cancelled = true; };
  }, [doc.id, src, textKind, tooBig]);

  if (!isPreviewable(doc.kind) || tooBig) {
    return (
      <p className="py-10 text-center text-sm text-slate-500">
        {tooBig ? t("El archivo es demasiado grande para la vista previa (máximo 1 MB). Descárgalo para verlo.") : t("Este tipo de archivo no tiene vista previa. Descárgalo para abrirlo.")}
      </p>
    );
  }
  if (doc.kind === "IMAGE") {
    return <ZoomImage src={src} alt={name} />;
  }
  if (doc.kind === "PDF") {
    return <iframe src={src} title={name} className="h-full min-h-[60vh] w-full rounded border border-slate-200 dark:border-slate-700" />;
  }
  if (!loaded || loaded.id !== doc.id) return <p className="py-10 text-center text-sm text-slate-500"><Loader2 size={18} className="mx-auto animate-spin" /></p>;
  if (loaded.text === null) return <p className="py-10 text-center text-sm text-red-600">{t("No se pudo cargar el archivo.")}</p>;
  return doc.kind === "MARKDOWN" ? (
    <div data-testid="doc-markdown"><Markdown>{loaded.text}</Markdown></div>
  ) : (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-900" data-testid="doc-text">{loaded.text}</pre>
  );
}

/** Vista previa de un documento de la papelera: solo se puede ver, descargar o restaurar. */
function TrashViewer({ doc, busy, onClose, onRestore }: { doc: TrashedDocumentRow; busy: boolean; onClose: () => void; onRestore: () => void }) {
  const t = useT();
  const locale = useIntlLocale();
  const src = `/api/documents/${doc.id}`;
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<span className="truncate">{doc.name}</span>}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {formatBytes(doc.size, locale)} · {t("Borrado por {name} el {date}", { name: doc.deletedByName ?? t("Usuario eliminado"), date: formatDate(doc.deletedAt, "dateNumeric", locale) })}
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onRestore} disabled={busy}>
              <RotateCcw size={16} /> {t("Restaurar")}
            </button>
            <a className="btn-primary" href={`${src}?download=1`} download>
              <Download size={16} /> {t("Descargar")}
            </a>
          </span>
        </div>
      }
    >
      <DocPreview doc={doc} name={doc.name} src={src} />
    </Modal>
  );
}
