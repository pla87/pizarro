"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { editorMarkdown } from "@/lib/editor-markdown";
import { keepUntouchedMarkdown, markdownUnits } from "@/lib/markdown-keep";
import { normalizeEditorMarkdown } from "@/lib/markdown-entities";
import { RichTextEditor } from "../ui/RichTextEditor";

/** Lo que el diálogo de la release necesita del editor: el Markdown actual, leído en el momento. */
export interface ReleaseEditorApi {
  read: () => string;
}

const NO_USERS: never[] = [];
const noop = () => {};

/**
 * Texto de la release con el editor con barra (preferencia «Con barra de formato»). Va en su propio trozo de código (con
 * TipTap): el diálogo lo carga solo con esa preferencia.
 *
 * `value` es el Markdown exacto (el generado, o el que dejó un cambio de cabecera o pie): mientras no se toca, `read()` lo
 * devuelve tal cual. Al editar, el editor solo avisa (sin escribir el Markdown entero en cada tecla, que con releases de
 * cientos de tareas se notaba) y `read()` lo escribe al pedirlo, conservando el texto exacto de los bloques no tocados
 * (markdown-keep.ts): así Copiar, .md y .txt dan lo mismo que con el editor Markdown y la cabecera y el pie se pueden
 * seguir cambiando.
 */
export function ReleaseRichEditor({ value, label, onEdited, apiRef }: {
  value: string;
  label: string;
  /** Tras cada cambio de la persona: si el texto ha quedado vacío. */
  onEdited: (empty: boolean) => void;
  apiRef: React.Ref<ReleaseEditorApi>;
}) {
  const editor = useRef<Editor | null>(null);
  const dirty = useRef(false);
  // Un `value` nuevo recarga el editor (RichTextEditor, en su efecto, que va antes que este): vuelve a estar sin tocar.
  useLayoutEffect(() => {
    dirty.current = false;
  }, [value]);
  useImperativeHandle(apiRef, () => ({
    read: () => {
      const ed = editor.current;
      if (!dirty.current || !ed) return value;
      return keepUntouchedMarkdown(value, normalizeEditorMarkdown(ed.getMarkdown()), editorMarkdown);
    },
  }), [value]);
  // En ratos libres se prepara cómo escribe el editor cada bloque del texto: la primera lectura tras editar una release
  // grande (cientos de tareas) no tiene que hacerlo todo de golpe.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: (d: { timeRemaining: () => number }) => void) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const units = markdownUnits(value);
    let next = 0;
    let id = 0;
    const work = (deadline: { timeRemaining: () => number }) => {
      while (next < units.length && deadline.timeRemaining() > 2) editorMarkdown(units[next++]!);
      if (next < units.length) id = idle(work);
    };
    id = idle(work);
    return () => cancel(id);
  }, [value]);
  return (
    <RichTextEditor
      value={value}
      onChange={noop}
      onEdit={(ed) => {
        dirty.current = true;
        onEdited(ed.isEmpty);
      }}
      onReady={(ed) => {
        editor.current = ed;
      }}
      placeholder={label}
      users={NO_USERS}
      className="[&_.ProseMirror]:min-h-[40vh]"
    />
  );
}
