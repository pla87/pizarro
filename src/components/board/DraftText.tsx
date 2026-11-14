"use client";

// Piezas comunes de los diálogos que generan un texto en Markdown a partir de tareas y plantillas de cabecera y pie:
// «Generar release» y «Generar plan de trabajo». El texto del paso 2 se edita con la preferencia de Mi perfil (editor con
// barra de formato o Markdown con Editar / Vista previa) y la cabecera y el pie se eligen entre las plantillas de la
// persona, las del proyecto y, en el plan, las de serie.

import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { importWhenOnline } from "@/lib/connection";
import type { BoardTask, EditorModeValue, TemplateOption } from "@/lib/types";
import { cn } from "../ui/cn";
import { Markdown } from "../ui/Markdown";
import { MentionText } from "../ui/MentionText";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";
import type { ReleaseEditorApi, ReleaseRichEditor as RichEditorComponent } from "./ReleaseRichEditor";

/**
 * Estado del texto del paso 2. Con la preferencia «Con barra de formato» se usa el mismo editor que las descripciones
 * (sin Editar / Vista previa): `content` es entonces el Markdown cargado en el editor y lo que la persona escribe se lee del
 * editor al usarlo (`currentText`). `richEmpty`: si lo ha dejado vacío (null mientras no lo toque).
 */
export function useDraftText(editorMode: EditorModeValue) {
  const rich = editorMode === "WYSIWYG";
  const [content, setContent] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [RichEditor, setRichEditor] = useState<typeof RichEditorComponent | null>(null);
  const richApi = useRef<ReleaseEditorApi>(null);
  const [richEmpty, setRichEmpty] = useState<boolean | null>(null);
  useEffect(() => {
    if (!rich) return;
    let alive = true;
    // Se pide al abrir el diálogo (en el paso 1): al generar ya suele estar. Mientras llega, el campo de texto normal.
    importWhenOnline(() => import("./ReleaseRichEditor")).then((m) => alive && setRichEditor(() => m.ReleaseRichEditor), () => {});
    return () => {
      alive = false;
    };
  }, [rich]);
  return {
    rich, content, setContent, tab, setTab, RichEditor, richApi, richEmpty, setRichEmpty,
    /** Markdown actual (lo que se copia, se descarga y se guarda). */
    currentText: () => (rich && richApi.current ? richApi.current.read() : content),
    /** Sustituye el texto entero (generar, cambiar cabecera o pie): el editor lo vuelve a cargar. */
    loadText: (text: string) => {
      setContent(text);
      setRichEmpty(null);
    },
    /** ¿Ha quedado vacío? (para desactivar las acciones que guardan). */
    empty: () => richEmpty ?? !content.trim(),
  };
}

type DraftText = ReturnType<typeof useDraftText>;

/**
 * Campo del texto del paso 2: el editor con barra o el Markdown con pestañas Editar / Vista previa. `idPrefix` da los ids
 * de las pestañas (`release-tab-edit`…) y `dataAttr` marca el editor para las pruebas (`data-release-editor="rich"`).
 */
export function DraftTextEditor({ draft, label, idPrefix, dataAttr, onEscape }: {
  draft: DraftText;
  label: string;
  idPrefix: string;
  dataAttr: string;
  onEscape: () => void;
}) {
  const t = useT();
  const { rich, RichEditor, content, setContent, tab, setTab, richApi, setRichEmpty } = draft;
  const textarea = (extra: Record<string, unknown>) => (
    <textarea
      className="input min-h-[45vh] flex-1 font-mono text-[13px] leading-relaxed"
      value={content}
      onChange={(e) => setContent(e.target.value)}
      spellCheck={false}
      aria-label={label}
      {...extra}
    />
  );
  if (rich) {
    return RichEditor ? (
      <div {...{ [dataAttr]: "rich" }} className="flex min-h-0 flex-1 flex-col">
        <RichEditor value={content} label={label} onEdited={setRichEmpty} onEscape={onEscape} apiRef={richApi} />
      </div>
    ) : (
      // Mientras llega el editor con barra (red lenta): el texto se puede ir editando aquí y el editor lo recoge.
      textarea({ [dataAttr]: "provisional" })
    );
  }
  return (
    <>
      <div role="tablist" className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {(["edit", "preview"] as const).map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tb}`}
            aria-selected={tab === tb}
            aria-controls={`${idPrefix}-tabpanel`}
            onClick={() => setTab(tb)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium",
              tab === tb ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500",
            )}
          >
            {tb === "edit" ? <><Pencil size={14} /> {t("Editar")}</> : <><Eye size={14} /> {t("Vista previa")}</>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${idPrefix}-tabpanel`} aria-labelledby={`${idPrefix}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "edit" ? (
          textarea({ "data-autofocus": true })
        ) : (
          <div className="min-h-[45vh] rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <Markdown>{content}</Markdown>
          </div>
        )}
      </div>
    </>
  );
}

type TemplateGroups = { headers: TemplateOption[]; footers: TemplateOption[] };

/**
 * Selectores de cabecera y pie: las plantillas de la persona («Tuyas»), las del proyecto («Del proyecto») y, si se dan,
 * las de serie («De serie»). Sin grupos del proyecto ni de serie, la lista es plana (como siempre en las releases).
 */
export function TemplatePickers({ own, project, builtin, headerId, footerId, onChange, idPrefix }: {
  own: TemplateGroups;
  project: TemplateGroups;
  builtin?: TemplateGroups;
  headerId: string;
  footerId: string;
  onChange: (which: "header" | "footer", id: string) => void;
  idPrefix: string;
}) {
  const t = useT();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["header", "footer"] as const).map((which) => {
        const mine = which === "header" ? own.headers : own.footers;
        const proj = which === "header" ? project.headers : project.footers;
        const serie = (which === "header" ? builtin?.headers : builtin?.footers) ?? [];
        const options = (list: TemplateOption[]) => list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>);
        return (
          <div key={which}>
            <label className="label" htmlFor={`${idPrefix}-${which}`}>{which === "header" ? t("Cabecera") : t("Pie")}</label>
            <select id={`${idPrefix}-${which}`} className="input" value={which === "header" ? headerId : footerId} onChange={(e) => onChange(which, e.target.value)}>
              <option value="">{t("Ninguna")}</option>
              {proj.length === 0 && serie.length === 0 ? (
                options(mine)
              ) : (
                <>
                  {mine.length > 0 && <optgroup label={t("Tuyas")}>{options(mine)}</optgroup>}
                  {proj.length > 0 && <optgroup label={t("Del proyecto")}>{options(proj)}</optgroup>}
                  {serie.length > 0 && <optgroup label={t("De serie")}>{options(serie)}</optgroup>}
                </>
              )}
            </select>
          </div>
        );
      })}
    </div>
  );
}

/** «Cabecera y pie salen de tus plantillas y de las plantillas del proyecto.», con los enlaces a cada sitio. */
export function TemplateSourceNote({ projectId, projectTab, withProject }: { projectId: string; projectTab: string; withProject: boolean }) {
  const t = useT();
  return (
    <span className="mr-auto text-xs text-slate-500">
      {t("Cabecera y pie salen de")} <Link className="text-brand-600 dark:text-brand-300 hover:underline" href="/settings?tab=plantillas">{t("tus plantillas")}</Link>
      {withProject && <> {t("y de las")} <Link className="text-brand-600 dark:text-brand-300 hover:underline" href={`/p/${projectId}/settings?tab=${projectTab}`}>{t("plantillas del proyecto")}</Link></>}.
    </span>
  );
}

/**
 * Paso 1: las tareas que entran en el texto, con «Todas» y «Ninguna». `badge` añade algo al final de una fila (la marca
 * de tarea fija). `onTouch` avisa de que la persona ha cambiado la selección a mano.
 */
export function TaskPickList({ tasks, chosen, setChosen, onTouch, badge }: {
  tasks: BoardTask[];
  chosen: ReadonlySet<string>;
  setChosen: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  onTouch: () => void;
  badge?: (task: BoardTask) => React.ReactNode;
}) {
  const t = useT();
  const { kindById } = useBoard();
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("Tareas incluidas")}</span>
        <div className="flex gap-1">
          {/* Sin efecto posible (ya están todas o ninguna), el botón queda desactivado. */}
          <button className="btn-ghost py-1 text-xs" disabled={tasks.every((task) => chosen.has(task.id))} onClick={() => { onTouch(); setChosen(new Set(tasks.map((x) => x.id))); }}>{t("Todas")}</button>
          <button className="btn-ghost py-1 text-xs" disabled={!tasks.some((task) => chosen.has(task.id))} onClick={() => { onTouch(); setChosen(new Set()); }}>{t("Ninguna")}</button>
        </div>
      </div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {tasks.map((task) => (
          <li key={task.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={chosen.has(task.id)}
                onChange={() => {
                  onTouch();
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (next.has(task.id)) next.delete(task.id);
                    else next.add(task.id);
                    return next;
                  });
                }}
              />
              <TypeBadge kind={kindById.get(task.kindId)} />
              <span className="min-w-0 flex-1 truncate text-sm"><MentionText text={task.title} /></span>
              {badge?.(task)}
            </label>
          </li>
        ))}
        {tasks.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">{t("No hay tareas.")}</li>}
      </ul>
    </>
  );
}
