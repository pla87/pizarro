"use client";

import { AlertCircle, ArrowLeft, Code2, Download, Eye, File as FileIcon, FileCode, FileImage, FileText, FileType, Loader2, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Search, StickyNote, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNote, deleteDocument, deleteDocumentForever, renameDocument, restoreDocument, searchNotes, setDocumentPinned } from "@/actions/documents";
import { filesFrom, formatBytes, useFileDrop } from "@/components/board/upload";
import { uploadDocument, documentUploadName } from "@/components/docs/uploadDocuments";
import { useDocTaskDialogs } from "@/components/docs/useDocTaskDialogs";
import { lazyDialog } from "@/components/lazyDialog";
import { HtmlPreview } from "@/components/docs/HtmlPreview";
import { ZoomImage } from "@/components/docs/ZoomImage";
import { LazyMarkdown } from "@/components/ui/LazyMarkdown";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { MODAL_SIZE_REM, Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { MessageWithLinks, useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { useIntlLocale, useT } from "@/i18n/client";
import { DOCUMENT_PREVIEW_MAX_BYTES, DOCUMENT_TRASH_DAYS, decodeDocumentText, isPreviewable, type DocumentKindName } from "@/lib/document-kind";
import type { DocumentRow, TrashedDocumentRow } from "@/lib/documents";
import type { EditorModeValue, UserOption } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { headingIdForHash } from "@/lib/heading-ids";
import { normalizeSearch } from "@/lib/search-accents";
import { useSafeRefresh } from "@/components/useSafeRefresh";
import { actionThrowResult } from "@/lib/stale-action";

interface Props {
  projectId: string;
  projectName: string;
  documents: DocumentRow[];
  trashed: TrashedDocumentRow[];
  fileMaxMb: number;
  maxCount: number;
  currentUserId: string;
  editorMode: EditorModeValue;
  /** Personas del proyecto, para las menciones de las notas. */
  users: UserOption[];
  /** Documento que se abre al entrar (enlace `?doc=`). */
  initialOpenId?: string | null;
  /** El enlace `?doc=` apunta a un documento de la papelera o que no existe en este proyecto. */
  linkNotice?: "trashed" | "gone" | null;
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
  HTML: { icon: Code2, className: "text-orange-600 bg-orange-50 dark:bg-orange-500/15 dark:text-orange-300" },
  OTHER: { icon: FileIcon, className: "text-slate-400 bg-slate-100 dark:bg-slate-800 dark:text-slate-400" },
};

/** Icono de las notas escritas en la app (son Markdown, pero se distinguen de un .md subido). */
const NOTE_ICON = { icon: StickyNote, className: "text-amber-600 bg-amber-50 dark:bg-amber-500/15 dark:text-amber-300" };
const iconOf = (d: { kind: DocumentKindName; note: boolean }) => (d.note ? NOTE_ICON : ICONS[d.kind]);

// El editor de notas (con el de las descripciones dentro) no va en el código inicial de la Documentación.
const NoteEditor = lazyDialog(() => import("@/components/docs/NoteEditor"), (m) => m.NoteEditor);

/** Espera tras dejar de escribir en el buscador antes de buscar también en el texto de las notas. */
const NOTE_SEARCH_DELAY_MS = 250;

let nextKey = 1;

export function DocsManager({ projectId, projectName, documents: listed, trashed, fileMaxMb, maxCount, currentUserId, editorMode, users, initialOpenId = null, linkNotice = null }: Props) {
  const t = useT();
  const locale = useIntlLocale();
  const safeRefresh = useSafeRefresh();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [showTrash, setShowTrash] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  // Nota recién creada: se abre (en modo edición) antes de que llegue la lista nueva con ella.
  const [created, setCreated] = useState<DocumentRow | null>(null);
  const [creating, setCreating] = useState(false);
  // La recién creada se abre en modo edición solo esa vez.
  const [freshId, setFreshId] = useState<string | null>(null);
  const documents = useMemo(() => (created && !listed.some((d) => d.id === created.id) ? [created, ...listed] : listed), [created, listed]);
  // Notas cuyo texto contiene lo buscado (lo pide al servidor; el nombre se filtra aquí).
  const [noteHits, setNoteHits] = useState<{ q: string; ids: Set<string> } | null>(null);
  // Cola de subida en serie: cada archivo es una petición y el servidor aplica sus límites a cada una.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const searchInput = useRef<HTMLInputElement>(null);
  // Enlace «?doc=» a un documento que ya no está (o está en la papelera): se avisa una vez en vez de abrir la lista sin más.
  const noticed = useRef(false);
  useEffect(() => {
    if (!linkNotice || noticed.current) return;
    noticed.current = true;
    toast(linkNotice === "trashed" ? t("Ese documento está en la papelera") : t("Ese documento ya no está en la Documentación"), "error");
  }, [linkNotice, toast, t]);
  const pendingFocus = useRef<{ gone: string; next: string | null } | null>(null);
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p || documents.some((x) => x.id === p.gone)) return;
    pendingFocus.current = null;
    const next = p.next ? document.querySelector<HTMLElement>(`[data-doc-open="${p.next}"]`) : null;
    (next ?? searchInput.current)?.focus();
  }, [documents]);

  const kindLabel = (d: { kind: DocumentKindName; note: boolean }) => {
    const k = d.kind;
    if (d.note) return t("Nota");
    return k === "TEXT" ? t("Texto") : k === "MARKDOWN" ? "Markdown" : k === "PDF" ? "PDF" : k === "IMAGE" ? t("Imagen") : k === "HTML" ? "HTML" : t("Otro");
  };

  async function newNote() {
    if (creating) return;
    setCreating(true);
    let res: Awaited<ReturnType<typeof createNote>>;
    try {
      res = await createNote(projectId).catch((e: unknown) => actionThrowResult(e, t));
    } finally {
      setCreating(false);
    }
    if (!res.ok) return toast(res.error, "error");
    setShowTrash(false);
    setCreated(res.data);
    setFreshId(res.data.id);
    setOpenId(res.data.id);
    safeRefresh();
  }

  async function togglePin(d: DocumentRow) {
    setBusyId(d.id);
    const res = await setDocumentPinned(d.id, !d.pinnedAt).catch((e: unknown) => actionThrowResult(e, t));
    setBusyId(null);
    if (!res.ok) return toast(res.error, "error");
    toast(d.pinnedAt ? t("Quitado de «Notas generales»") : t("Fijado en «Notas generales»"));
    safeRefresh();
  }

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
        safeRefresh();
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

  const needle = normalizeSearch(query.trim());
  const hasNotes = documents.some((d) => d.note);
  // También en el texto de las notas: lo busca el servidor, con una pequeña espera mientras se escribe.
  useEffect(() => {
    const q = query.trim();
    if (!q || !hasNotes) return;
    const timer = setTimeout(() => {
      void searchNotes(projectId, q).catch(() => null).then((res) => {
        if (res?.ok) setNoteHits({ q, ids: new Set(res.data) });
      });
    }, NOTE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, projectId, hasNotes]);
  const textHits = noteHits && noteHits.q === query.trim() ? noteHits.ids : null;
  const shown = needle ? documents.filter((d) => normalizeSearch(d.name).includes(needle) || (d.note && !!textHits?.has(d.id))) : documents;
  // Fijados arriba («Notas generales»), en el orden en que se fijaron; el resto, como siempre.
  const pinned = shown.filter((d) => d.pinnedAt).sort((a, b) => a.pinnedAt!.localeCompare(b.pinnedAt!));
  const unpinned = shown.filter((d) => !d.pinnedAt);
  const open = documents.find((d) => d.id === openId) ?? null;
  const openTrashed = trashed.find((d) => d.id === openId) ?? null;
  const full = documents.length >= maxCount;

  /** Envía a la papelera desde la lista, sin abrir el visor; mismo aviso con Deshacer que el botón Borrar del visor. */
  async function trashFromList(d: DocumentRow) {
    // La fila desaparece de la lista: el foco pasa a la siguiente (o a la anterior, o al buscador) cuando llegue la lista nueva.
    const at = shown.findIndex((x) => x.id === d.id);
    const neighbour = shown[at + 1] ?? shown[at - 1] ?? null;
    setBusyId(d.id);
    let res: Awaited<ReturnType<typeof deleteDocument>>;
    try {
      res = await deleteDocument(d.id).catch((e: unknown) => actionThrowResult(e, t));
    } finally {
      setBusyId(null);
    }
    if (!res.ok) return toast(res.error, "error");
    pendingFocus.current = { gone: d.id, next: neighbour?.id ?? null };
    toast(t("Documento enviado a la papelera"), "undo", {
      label: t("Deshacer"),
      // Devuelve ese documento de la papelera, haya pasado lo que haya pasado después (no es «lo último»).
      independent: true,
      onClick: () => {
        void restoreDocument(d.id).catch((e: unknown) => actionThrowResult(e, t)).then((r) => {
          if (!r.ok) return toast(r.error, "error");
          toast(t("Documento restaurado"));
          safeRefresh();
        });
      },
    });
    safeRefresh();
  }

  async function restore(d: DocumentRow) {
    setBusyId(d.id);
    const res = await restoreDocument(d.id).catch((e: unknown) => actionThrowResult(e, t));
    setBusyId(null);
    if (!res.ok) return toast(res.error, "error");
    setOpenId(null);
    toast(t("Documento restaurado"));
    safeRefresh();
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
    const res = await deleteDocumentForever(d.id).catch((e: unknown) => actionThrowResult(e, t));
    setBusyId(null);
    if (!res.ok) return toast(res.error, "error");
    setOpenId(null);
    toast(t("Documento borrado definitivamente"));
    safeRefresh();
  }

  /** Fila de un documento (en «Notas generales» o en la lista). */
  function row(d: DocumentRow) {
    const { icon: Icon, className } = iconOf(d);
    return (
      <li key={d.id} className="flex items-center hover:bg-slate-50 focus-within:bg-slate-50 dark:hover:bg-slate-800/60 dark:focus-within:bg-slate-800/60">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/60"
          data-doc-open={d.id}
          onClick={() => setOpenId(d.id)}
        >
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", className)} title={kindLabel(d)}>
            <Icon size={18} aria-hidden />
            <span className="sr-only">{kindLabel(d)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-medium">{d.name}</span>
            <span className="block truncate text-xs text-slate-500">
              {formatBytes(d.size, locale)} · {d.createdByName ?? t("Usuario eliminado")} · {formatDate(d.createdAt, "date", locale)}
            </span>
          </span>
        </button>
        {/* Acciones secundarias en «⋯» (la papelera, siempre a la vista, se pulsaba sin querer); abrir sigue siendo la fila. */}
        <Menu
          align="end"
          className="mx-2 shrink-0"
          label={t("Más acciones de «{name}»", { name: d.name })}
          panelClassName="w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
          trigger={({ props }) => (
            <button type="button" className="btn-icon" aria-label={t("Más acciones de «{name}»", { name: d.name })} title={t("Más acciones")} data-testid="doc-menu-btn" {...props}>
              <MoreHorizontal size={18} aria-hidden />
            </button>
          )}
        >
          <a
            role="menuitem"
            tabIndex={-1}
            href={`/api/documents/${d.id}?download=1`}
            download
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
          >
            <Download size={15} aria-hidden /> {t("Descargar")}
          </a>
          <MenuItem icon={d.pinnedAt ? PinOff : Pin} disabled={busyId === d.id} data-testid="doc-pin-btn" onClick={() => void togglePin(d)}>
            {d.pinnedAt ? t("Quitar de «Notas generales»") : t("Fijar en «Notas generales»")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={Trash2} danger disabled={busyId === d.id} data-testid="doc-trash-btn" onClick={() => void trashFromList(d)}>
            {t("Enviar a la papelera")}
          </MenuItem>
        </Menu>
      </li>
    );
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
          <button type="button" className="btn-secondary" onClick={() => void newNote()} disabled={full || creating} data-testid="docs-new-note">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <StickyNote size={16} />} {t("Nueva nota")}
          </button>
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
        {t("Archivos de «{name}»: {count} de {max} · máximo {mb} MB por archivo.", { name: projectName, count: documents.length, max: maxCount, mb: fileMaxMb })}
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
              <span dir="auto" className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.status === "uploading" ? (
                <span className="shrink-0 text-xs text-slate-500">{t("Subiendo…")}</span>
              ) : (
                <>
                  <span className="min-w-0 shrink text-xs text-red-600 dark:text-red-400" role="alert"><MessageWithLinks message={u.error ?? ""} /></span>
                  <button type="button" className="btn-icon shrink-0" aria-label={t("Descartar «{name}»", { name: u.name })} onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))}>
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
            {t("A los {days} días se eliminan para siempre; hasta entonces ocupan espacio del proyecto.", { days: DOCUMENT_TRASH_DAYS })}
          </p>
          {trashed.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">{t("La papelera está vacía.")}</p>
          ) : (
            <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800" data-testid="docs-trash-list">
              {trashed.map((d) => {
                const { icon: Icon, className } = iconOf(d);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid="docs-trash-item">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", className)} title={kindLabel(d)}>
                      <Icon size={18} aria-hidden />
                      <span className="sr-only">{kindLabel(d)}</span>
                    </span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span dir="auto" className="block truncate text-sm font-medium">{d.name}</span>
                      <span className="block text-xs text-slate-500">
                        {formatBytes(d.size, locale)} · {t("Borrado por {name} el {date}", { name: d.deletedByName ?? t("Usuario eliminado"), date: formatDate(d.deletedAt, "date", locale) })} ·{" "}
                        {d.daysLeft === 0 ? t("se elimina hoy") : d.daysLeft === 1 ? t("queda 1 día") : t("quedan {n} días", { n: d.daysLeft })}
                      </span>
                    </span>
                    {/* En el móvil «Ver» y «Restaurar» van solo con su icono (el nombre accesible ya dice qué y de cuál) y el grupo
                        pasa a otra línea si no cabe: «Borrar definitivamente» salía cortado a 390 y 360 px. */}
                    <span className="flex min-w-0 flex-wrap gap-1.5">
                      <button type="button" className="btn-secondary" onClick={() => setOpenId(d.id)} disabled={busyId === d.id} aria-label={t("Ver {name}", { name: d.name })} title={t("Ver")}>
                        <Eye size={16} aria-hidden /> <span className="hidden sm:inline">{t("Ver")}</span>
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void restore(d)} disabled={busyId === d.id} aria-label={t("Restaurar «{name}»", { name: d.name })} title={t("Restaurar")}>
                        <RotateCcw size={16} aria-hidden /> <span className="hidden sm:inline">{t("Restaurar")}</span>
                      </button>
                      <button type="button" className="btn-danger" onClick={() => void removeForever(d)} disabled={busyId === d.id} aria-label={t("Borrar definitivamente «{name}»", { name: d.name })}>
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
            {t("Guías, notas, PDF e imágenes de referencia, para todo el equipo del proyecto. Arrastra archivos aquí, pégalos o usa «Subir archivos».")}
          </p>
          <span className="mt-2 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => void newNote()} disabled={creating}>
              <StickyNote size={16} /> {t("Nueva nota")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
              <Upload size={16} /> {t("Subir archivos")}
            </button>
          </span>
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInput}
              type="search"
              className="input pl-9"
              placeholder={hasNotes ? t("Buscar por nombre o en las notas…") : t("Buscar por nombre…")}
              aria-label={t("Buscar documentos")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">{t("Ningún documento coincide con «{query}».", { query })}</p>
          ) : (
            <>
              {pinned.length > 0 && (
                <section aria-labelledby="docs-pinned-title" className="mb-4">
                  <h2 id="docs-pinned-title" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                    <Pin size={14} aria-hidden /> {t("Notas generales")}
                  </h2>
                  <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800" data-testid="docs-pinned-list">
                    {pinned.map((d) => row(d))}
                  </ul>
                </section>
              )}
              {unpinned.length > 0 && (
                <>
                  {pinned.length > 0 && <h2 className="mb-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">{t("Todos los documentos")}</h2>}
                  <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800" data-testid="docs-list">
                    {unpinned.map((d) => row(d))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}

      {open && !showTrash && (
        <DocViewer
          key={open.id} doc={open} docs={documents} fromLink={open.id === initialOpenId} projectId={projectId} currentUserId={currentUserId} editorMode={editorMode}
          users={users} fileMaxMb={fileMaxMb} isNew={open.id === freshId} onPin={() => void togglePin(open)} pinBusy={busyId === open.id} onClose={() => { setOpenId(null); setFreshId(null); }}
        />
      )}
      {openTrashed && showTrash && (
        <TrashViewer key={openTrashed.id} doc={openTrashed} busy={busyId === openTrashed.id} onClose={() => setOpenId(null)} onRestore={() => void restore(openTrashed)} />
      )}
    </div>
  );
}

/**
 * Visor en un modal: imagen, PDF del visor del navegador, texto plano, Markdown o HTML (aislado); el resto solo se descarga.
 * Una nota se ve y se edita aquí mismo (NoteEditor); `isNew`: recién creada, se abre ya en modo edición.
 */
function DocViewer({ doc, docs, fromLink, projectId, currentUserId, editorMode, users, fileMaxMb, isNew, onPin, pinBusy, onClose }: {
  doc: DocumentRow; docs: DocumentRow[]; fromLink: boolean; projectId: string; currentUserId: string; editorMode: EditorModeValue;
  users: UserOption[]; fileMaxMb: number; isNew: boolean; onPin: () => void; pinBusy: boolean; onClose: () => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const safeRefresh = useSafeRefresh();
  const toast = useToast();
  const [name, setName] = useState(doc.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.name);
  const [busy, setBusy] = useState(false);
  // El tamaño de una nota cambia al escribir (el de la lista llega con el refresco al cerrar).
  const [size, setSize] = useState(doc.size);
  // Cerrado el visor, el guardado de lo último escrito puede llegar después: entonces refresca la lista (tamaño).
  const closed = useRef(false);
  const src = `/api/documents/${doc.id}`;
  const big = doc.kind === "PDF" || doc.kind === "IMAGE";
  const second = useDocTaskDialogs({ projectId, currentUserId, editorMode, doc: { id: doc.id, name, kind: doc.kind }, viewerWidth: MODAL_SIZE_REM[big ? "2xl" : "xl"] });
  // PDF e imágenes: visor grande, casi a toda la altura; deja margen a los lados para los botones y el diálogo de al lado.

  async function remove() {
    setBusy(true);
    const res = await deleteDocument(doc.id).catch((e: unknown) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Documento enviado a la papelera"), "undo", {
      label: t("Deshacer"),
      // Devuelve ese documento de la papelera, haya pasado lo que haya pasado después (no es «lo último»).
      independent: true,
      onClick: () => {
        void restoreDocument(doc.id).catch((e: unknown) => actionThrowResult(e, t)).then((r) => {
          if (!r.ok) return toast(r.error, "error");
          toast(t("Documento restaurado"));
          safeRefresh();
        });
      },
    });
    onClose();
    safeRefresh();
  }

  async function rename() {
    const next = draft.trim();
    if (!next || next === name) return setEditing(false);
    setBusy(true);
    const res = await renameDocument(doc.id, next).catch((e: unknown) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setName(res.data.name);
    setEditing(false);
    safeRefresh();
  }

  return (
    <>
    <Modal
      open
      onClose={() => {
        closed.current = true;
        if (doc.note) safeRefresh();
        onClose();
      }}
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
            <span dir="auto" className="truncate">{name}</span>
            <button type="button" className="btn-icon shrink-0" aria-label={t("Renombrar")} title={t("Renombrar")} onClick={() => { setDraft(name); setEditing(true); }}>
              <Pencil size={14} />
            </button>
          </span>
        )
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {formatBytes(size, locale)} · {doc.createdByName ?? t("Usuario eliminado")} · {formatDate(doc.createdAt, "date", locale)}
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button" className="btn-secondary" onClick={onPin} disabled={pinBusy} aria-pressed={!!doc.pinnedAt} data-testid="doc-viewer-pin"
              title={doc.pinnedAt ? t("Quitar de «Notas generales»") : t("Fijar en «Notas generales»")}
              aria-label={doc.pinnedAt ? t("Quitar de «Notas generales»") : t("Fijar en «Notas generales»")}
            >
              {doc.pinnedAt ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />} <span className="hidden sm:inline">{doc.pinnedAt ? t("Desfijar") : t("Fijar")}</span>
            </button>
            {/* Se puede deshacer (va a la papelera): como en el «⋯» de la lista, no «Borrar» en rojo. */}
            <button type="button" className="btn-secondary" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={16} /> {t("Enviar a la papelera")}
            </button>
            <a className="btn-primary" href={`${src}?download=1`} download>
              <Download size={16} /> {t("Descargar")}
            </a>
          </span>
        </div>
      }
    >
      {doc.note ? (
        <NoteEditor
          docId={doc.id} projectId={projectId} currentUserId={currentUserId} editorMode={editorMode} users={users} fileMaxMb={fileMaxMb} startEditing={isNew}
          onSaved={(n) => (closed.current ? safeRefresh() : setSize(n))} onUploaded={safeRefresh}
        />
      ) : (
        <DocPreview doc={doc} name={name} src={src} projectId={projectId} docs={docs} fromLink={fromLink} />
      )}
    </Modal>
    {second.dialogs}
    </>
  );
}

function DocPreview({ doc, name, src, projectId, docs, fromLink }: { doc: DocumentRow; name: string; src: string; projectId: string; docs: DocumentRow[]; fromLink?: boolean }) {
  const t = useT();
  const textKind = doc.kind === "TEXT" || doc.kind === "MARKDOWN" || doc.kind === "HTML";
  const tooBig = textKind && doc.size > DOCUMENT_PREVIEW_MAX_BYTES;
  const [loaded, setLoaded] = useState<{ id: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!textKind || tooBig) return;
    let cancelled = false;
    fetch(src)
      // Los bytes se decodifican aquí (UTF-8, UTF-16 con BOM, charset declarado o Windows-1252); el saneado va después.
      .then(async (r) => (r.ok ? decodeDocumentText(new Uint8Array(await r.arrayBuffer()), doc.kind) : null))
      .catch(() => null)
      .then((text) => { if (!cancelled) setLoaded({ id: doc.id, text }); });
    return () => { cancelled = true; };
  }, [doc.id, doc.kind, src, textKind, tooBig]);

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
  if (doc.kind === "HTML") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">{t("Vista previa sin scripts ni contenido externo (imágenes, estilos o fuentes de otros sitios). Descárgalo para verlo completo.")}</p>
        <HtmlPreview html={loaded.text} title={name} projectId={projectId} docs={docs} selfId={doc.id} fromLink={fromLink} />
      </div>
    );
  }
  return doc.kind === "MARKDOWN" ? (
    <MarkdownPreview text={loaded.text} fromLink={fromLink} />
  ) : (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-900" data-testid="doc-text">{loaded.text}</pre>
  );
}

/**
 * Markdown de la Documentación con un `id` en cada título. Al llegar por un enlace «otro.md#apartado» (desde un HTML de la
 * misma Documentación) se desplaza a ese apartado, una vez.
 */
function MarkdownPreview({ text, fromLink }: { text: string; fromLink?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fromLink) return;
    const id = headingIdForHash(window.location.hash);
    const el = box.current;
    if (!id || !el) return;
    const scroll = () => {
      const target = el.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ block: "start" });
      return !!target;
    };
    if (scroll()) return;
    // El Markdown llega aparte (LazyMarkdown): si el apartado aún no está, se espera a que aparezca.
    const watch = new MutationObserver(() => {
      if (scroll()) watch.disconnect();
    });
    watch.observe(el, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [fromLink]);
  return <div ref={box} data-testid="doc-markdown"><LazyMarkdown headingIds>{text}</LazyMarkdown></div>;
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
      title={<span dir="auto" className="truncate">{doc.name}</span>}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {formatBytes(doc.size, locale)} · {t("Borrado por {name} el {date}", { name: doc.deletedByName ?? t("Usuario eliminado"), date: formatDate(doc.deletedAt, "date", locale) })}
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
      <DocPreview doc={doc} name={doc.name} src={src} projectId="" docs={[]} />
    </Modal>
  );
}
