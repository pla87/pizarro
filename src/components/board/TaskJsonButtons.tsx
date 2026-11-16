"use client";

// Botones discretos de la tarea en JSON (detalle y «Nueva tarea»): «Copiar tarea» (al portapapeles) e «Importar tarea»
// (menú: desde el portapapeles o desde un fichero .json/.txt). Si el navegador no deja leer el portapapeles, un cuadro
// para pegarlo a mano. Lo que se hace con el texto lo decide quien los usa (`onImport`).
import { ClipboardCopy, ClipboardPaste, FileUp, Import } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { TASKS_TEXT_MAX_CHARS } from "@/lib/task-json";
import { Menu, MenuItem } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { readClipboardText } from "./taskClipboard";
import { useShortcut } from "./shortcuts";

/** Lee un fichero de texto (.json, .txt) para importar tareas; null (y aviso) si es demasiado grande o no se puede leer. */
export async function readTasksFile(file: File, onError: (message: string) => void, t: (s: string, v?: Record<string, string | number>) => string): Promise<string | null> {
  if (file.size > TASKS_TEXT_MAX_CHARS * 2) {
    onError(t("«{name}» es demasiado grande para importarlo (máximo {mb} MB).", { name: file.name, mb: TASKS_TEXT_MAX_CHARS / 1_000_000 }));
    return null;
  }
  try {
    return await file.text();
  } catch {
    onError(t("No se ha podido leer «{name}».", { name: file.name }));
    return null;
  }
}

interface Props {
  /** Copiar la tarea (o lo que hay en el formulario) al portapapeles. */
  onCopy: () => void;
  /** Importar el texto leído (del portapapeles, de un fichero o pegado a mano). `true` si se importó. */
  onImport: (text: string) => Promise<boolean>;
  /** Atajos que funcionan ahí y se muestran (Ctrl+C sin texto seleccionado / Ctrl+V fuera de un campo). */
  shortcuts?: { copy?: boolean; paste?: boolean };
  className?: string;
}

export function TaskJsonButtons({ onCopy, onImport, shortcuts = {}, className }: Props) {
  const t = useT();
  const sc = useShortcut();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState<string | null>(null);
  const manualId = useId();
  const copyLabel = t("Copiar tarea");
  const importLabel = t("Importar tarea");
  const fromClipboard = async () => {
    const text = await readClipboardText();
    // El navegador no deja leerlo (permiso rechazado, móvil): se pega a mano en un cuadro.
    if (text === null) return setManual("");
    await onImport(text);
  };
  return (
    <div className={className ?? "flex shrink-0 items-center"}>
      <button
        type="button"
        className="btn-icon text-slate-500"
        onClick={onCopy}
        aria-label={copyLabel}
        title={shortcuts.copy ? `${t("Copiar la tarea al portapapeles (JSON)")} (${sc("Ctrl+C")})` : t("Copiar la tarea al portapapeles (JSON)")}
        data-task-json="copy"
      >
        <ClipboardCopy size={17} />
      </button>
      <Menu
        align="end"
        label={importLabel}
        className="relative shrink-0"
        panelClassName="w-60 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        trigger={({ props }) => (
          <button type="button" className="btn-icon text-slate-500" aria-label={importLabel} title={t("Importar una tarea en JSON")} data-task-json="import" {...props}>
            <Import size={17} />
          </button>
        )}
      >
        <MenuItem icon={ClipboardPaste} onClick={() => void fromClipboard()}>
          <span className="flex-1">{t("Desde el portapapeles")}</span>
          {shortcuts.paste && <kbd className="text-xs text-slate-400 max-md:hidden">{sc("Ctrl+V")}</kbd>}
        </MenuItem>
        <MenuItem icon={FileUp} onClick={() => fileRef.current?.click()}>
          {t("Desde un fichero")}
        </MenuItem>
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.txt,application/json,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-task-json="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void readTasksFile(file, (m) => toast(m, "error"), t).then((text) => text !== null && onImport(text));
        }}
      />
      {manual !== null && (
        <Modal open onClose={() => setManual(null)} title={importLabel} size="md">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onImport(manual).then((ok) => ok && setManual(null));
            }}
          >
            <label className="block text-sm" htmlFor={manualId}>{t("El navegador no deja leer el portapapeles. Pega aquí el JSON de la tarea:")}</label>
            <textarea id={manualId} className="input h-48 w-full font-mono text-xs" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && manual.trim()) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} autoFocus spellCheck={false} placeholder={'{ "format": "pizarro.task", … }'} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setManual(null)}>{t("Cancelar")}</button>
              <button type="submit" className="btn-primary" disabled={!manual.trim()}>{t("Importar")}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
