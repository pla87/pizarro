"use client";

// «Importar tareas» del tablero: pegar el JSON en un cuadro, leerlo del portapapeles o de un fichero (.json, .csv, .txt;
// también arrastrándolo encima), vista previa (de dónde viene, título, columna a la que irá y avisos) y crear todas de una
// vez (POST a /api/projects/[projectId]/import-tasks, que vuelve a leer el texto en el servidor: lib/task-import.ts).
// Acepta el JSON que descarga «Exportar», una lista de tareas, varias seguidas, lo que devuelva una IA (ver parseTasksText
// en lib/task-json.ts) y lo exportado de otros Kanban: Trello, Jira, GitHub, Asana o un CSV (lib/foreign-import/tasks.ts).
import { ClipboardPaste, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { appTimeZone } from "@/lib/format";
import { actionThrowResult } from "@/lib/stale-action";
import { isOfflineMessage } from "@/lib/connection";
import { parseTasksText, TASK_READ_FAILURE, TASKS_JSON_MAX, TASKS_TEXT_MAX_CHARS } from "@/lib/task-json";
import { importDiscardQuestion, importPreview } from "@/lib/task-json-form";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { cn } from "../ui/cn";
import { useToast } from "../ui/Toast";
import { SESSION_EXPIRED } from "../ui/session-expired";
import type { ImportTasksData } from "@/lib/task-import";
import { useBoard } from "./context";
import { readClipboardText } from "./taskClipboard";
import { readTasksFile } from "./TaskJsonButtons";
import { useFileDrop } from "./upload";

interface Props {
  /** Texto con el que se abre (Ctrl+V en el tablero con una tarea o varias en JSON). */
  initialText?: string;
  onClose: () => void;
}

type ImportResult = { ok: true; data: ImportTasksData } | { ok: false; error: string };

/**
 * Manda el texto a la ruta de importación tal cual (no a una acción de servidor: esas admiten como mucho 1 MB). Devuelve lo
 * mismo que una acción. Sin red, lanza (como una acción: `board.track` lo convierte en «Sin conexión: no se ha guardado»);
 * sin sesión, el aviso de sesión caducada (con su botón para entrar); demasiado grande (también si lo corta un proxy por
 * delante), el tope; cualquier otra respuesta que no sea de la ruta, el error genérico.
 */
async function postImport(projectId: string, text: string, columnId: string | null, t: (s: string, v?: Record<string, string | number>) => string): Promise<ImportResult> {
  const query = columnId ? `?columnId=${encodeURIComponent(columnId)}` : "";
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/import-tasks${query}`, { method: "POST", body: text, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
  const json: unknown = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, error: t(SESSION_EXPIRED) };
  if (json && typeof json === "object" && "ok" in json && (json.ok === true || typeof (json as { error?: unknown }).error === "string")) return json as ImportResult;
  if (res.status === 413) return { ok: false, error: t("El texto es demasiado largo para importarlo (máximo {mb} MB).", { mb: TASKS_TEXT_MAX_CHARS / 1_000_000 }) };
  return { ok: false, error: t("Error inesperado. Inténtalo de nuevo.") };
}

/** Tareas de la vista previa que se dibujan (el resto se cuenta). */
const PREVIEW_ROWS = 200;

export function ImportTasksDialog({ initialText = "", onClose }: Props) {
  const board = useBoard();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const uid = useId();
  const [text, setText] = useState(initialText);
  const [forced, setForced] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const columns = useMemo(() => [...board.columns].sort((a, b) => a.position - b.position), [board.columns]);
  // Con textos grandes, la vista previa va un paso por detrás de lo que se escribe.
  const shown = useDeferredValue(text);
  const read = useMemo(() => parseTasksText(shown, { t, timeZone: appTimeZone(), locale }), [shown, t, locale]);
  const rows = useMemo(() => read.tasks.map((x) => ({ n: x.n, title: x.task.title ?? null, ...importPreview(x.task, { columns, kinds: board.kinds }, forced || null, t) })), [read, columns, board.kinds, forced, t]);
  const ready = rows.filter((r) => r.title);
  const unreadable = read.failed.length + rows.length - ready.length;
  const columnName = (id: string | null) => columns.find((c) => c.id === id)?.name ?? "";

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await readTasksFile(file, (m) => toast(m, "error"), t);
    if (content !== null) setText(content);
  };
  const dropping = useFileDrop((files) => void loadFile(files[0]));
  const fromClipboard = async () => {
    const content = await readClipboardText();
    if (content === null) return toast(t("El navegador no deja leer el portapapeles: pega el texto en el cuadro."), "error");
    setText(content);
  };

  const submit = async () => {
    if (busy || !ready.length || read.tooMany || read.tooLong || read.error) return;
    setBusy(true);
    const res = await board.track(postImport(board.project.id, text, forced || null, t)).catch((e) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) {
      if (!isOfflineMessage(res.error, t)) toast(res.error, "error");
      return;
    }
    res.data.tasks.forEach(board.upsertTask);
    const n = res.data.tasks.length;
    toast(n === 1 ? t("1 tarea importada") : t("{n} tareas importadas", { n }));
    const notes = [...(res.data.warnings ?? []), ...res.data.failed.map((f) => (f.title ? `«${f.title}»: ${f.text}` : t("tarea {n}: {reason}", { n: f.n, reason: f.text }))), ...res.data.notices.map((x) => `«${x.title}»: ${x.text}`)];
    if (notes.length) {
      const list = notes.slice(0, 4).join("; ");
      toast(t("Importadas, salvo: {list}", { list: notes.length > 4 ? t("{list} y {n} más", { list, n: notes.length - 4 }) : list }), "error");
    }
    onClose();
    if (res.data.tasks[0]) board.revealTask(res.data.tasks[0].id);
  };

  // Con texto o fichero sin importar, cerrar (Escape, clic fuera, X o «Cancelar») pide confirmación («Hay tareas sin
  // importar» o, si no se ha leído ninguna, «¿Descartar el texto?»); importando, no se cierra.
  const confirming = useRef(false);
  const requestClose = async (): Promise<boolean> => {
    if (busy) return false;
    if (text.trim()) {
      if (confirming.current) return false;
      confirming.current = true;
      // Si la vista previa va por detrás de lo escrito (useDeferredValue), se lee el texto de ahora para no preguntar mal.
      const readable = shown === text ? ready.length : parseTasksText(text, { t, timeZone: appTimeZone(), locale }).tasks.filter((x) => x.task.title).length;
      const ok = await confirm(importDiscardQuestion(readable, t)).catch(() => false);
      confirming.current = false;
      if (!ok) return false;
    }
    onClose();
    return true;
  };

  const label = read.tooMany
    ? t("Máximo {n} tareas", { n: TASKS_JSON_MAX })
    : ready.length === 1
      ? t("Importar 1 tarea")
      : ready.length
        ? t("Importar {n} tareas", { n: ready.length })
        : t("Importar tareas");

  return (
    <Modal
      open
      onClose={requestClose}
      title={t("Importar tareas")}
      size="md"
      placement="top"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>{t("Cancelar")}</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy || !ready.length || read.tooMany || read.tooLong || !!read.error} data-import-submit>
            {busy && <Loader2 size={16} className="animate-spin" />} {label}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="label mb-0" htmlFor={`${uid}-text`}>{t("Tareas en JSON o CSV")}</label>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void fromClipboard()}>
                <ClipboardPaste size={14} /> {t("Desde el portapapeles")}
              </button>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => fileRef.current?.click()}>
                <FileUp size={14} /> {t("Desde un fichero")}
              </button>
              <input ref={fileRef} type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-hidden data-import-file onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void loadFile(f); }} />
            </div>
          </div>
          <textarea
            id={`${uid}-text`}
            className="input mt-1 h-36 w-full font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Pega aquí el JSON (lo que descarga «Exportar», una lista de tareas o varias seguidas), lo exportado de Trello, Jira, GitHub o Asana, o un CSV con cabecera; o arrastra un fichero .json, .csv o .txt")}
            spellCheck={false}
            maxLength={TASKS_TEXT_MAX_CHARS}
            data-autofocus
          />
        </div>

        {read.source && (
          <div className="text-xs text-slate-500" data-import-source>{t("Formato detectado: {name}", { name: read.source })}</div>
        )}
        {read.error && <div className="text-sm font-medium text-red-600" role="alert">{read.error}</div>}
        {read.warnings.length > 0 && (
          <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400" data-import-warnings>
            {read.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1"><TriangleAlert size={12} className="mt-0.5 shrink-0" /> <span className="min-w-0">{w}</span></li>
            ))}
          </ul>
        )}
        {(read.total > 0 || read.tooLong) && (
          <>
            <div className={cn("text-sm font-medium", (read.tooMany || read.tooLong) && "text-red-600")} role="status">
              {read.tooLong
                ? t("El texto es demasiado largo para importarlo (máximo {mb} MB).", { mb: TASKS_TEXT_MAX_CHARS / 1_000_000 })
                : read.tooMany
                  ? t("Hay {n} tareas y se importan como mucho {max} de una vez.", { n: read.total, max: TASKS_JSON_MAX })
                  : ready.length === 1 ? t("1 tarea detectada") : t("{n} tareas detectadas", { n: ready.length })}
              {!read.tooLong && unreadable > 0 && <span className="font-normal text-amber-700 dark:text-amber-400"> · {unreadable === 1 ? t("1 no se puede leer") : t("{n} no se pueden leer", { n: unreadable })}</span>}
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-column`}>{t("Columna de destino")}</label>
              <select id={`${uid}-column`} className="input" value={forced} onChange={(e) => setForced(e.target.value)}>
                <option value="">{t("La de cada tarea (si no existe, «{name}»)", { name: columns[0]?.name ?? "" })}</option>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700" data-import-preview>
              {rows.slice(0, PREVIEW_ROWS).map((r) => (
                <li key={r.n} className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate", !r.title && "text-slate-400 italic")}>{r.title ?? t("(sin título: no se importa)")}</span>
                    {r.title && <span className="max-w-[40%] shrink-0 truncate text-xs text-slate-500">→ {columnName(r.columnId)}</span>}
                  </div>
                  {r.title && r.notices.length > 0 && (
                    <div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" /> <span className="min-w-0">{r.notices.join("; ")}</span>
                    </div>
                  )}
                </li>
              ))}
              {read.failed.slice(0, 20).map((f) => (
                <li key={`f${f.n}`} className="px-2 py-1 text-xs text-slate-500 italic">{t("tarea {n}: {reason}", { n: f.n, reason: t(TASK_READ_FAILURE[f.reason]) })}</li>
              ))}
              {rows.length > PREVIEW_ROWS && <li className="px-2 py-1 text-xs text-slate-500">{t("y {n} más", { n: rows.length - PREVIEW_ROWS })}</li>}
            </ul>
          </>
        )}
      </div>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-brand-500/15 p-4 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-lg font-semibold text-brand-700 shadow-xl dark:bg-slate-900/90 dark:text-brand-300">
            {t("Suelta el fichero para importarlo")}
          </div>
        </div>
      )}
    </Modal>
  );
}
