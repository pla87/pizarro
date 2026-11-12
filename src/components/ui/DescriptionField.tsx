"use client";

import { Bold, Code, Code2, Heading2, Heading3, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Minus, Quote, Strikethrough, Underline } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { indentLines, insertLink, insertRule, toggleCodeBlock, toggleLinePrefix, toggleWrap, type EditResult } from "@/lib/markdown-edit";
import { cn } from "./cn";
import { DictationButton, insertIntoField } from "./DictationButton";
import { FormatToolbar, FORMAT_BAR_CLASS, FORMAT_BOX_CLASS, type FormatItems } from "./FormatToolbar";
import { MentionTextarea, type MentionCommand } from "./MentionTextarea";
import { applyTextareaEdit } from "./textarea-edit";
import { tablesOnlyMarkdown } from "@/lib/paste-table";

import type { EditorModeValue, UserOption } from "@/lib/types";

// El editor con barra (TipTap) pesa: solo se descarga para quien lo usa (el tablero lo precarga en reposo).
type RichEditor = typeof import("./RichTextEditor").RichTextEditor;
let richEditor: RichEditor | null = null;
let richEditorLoad: Promise<RichEditor> | null = null;
function loadRichEditor(): Promise<RichEditor> {
  richEditorLoad ??= import("./RichTextEditor").then(
    (m) => (richEditor = m.RichTextEditor),
    (e: unknown) => {
      richEditorLoad = null; // sin red: se reintenta la próxima vez
      throw e;
    },
  );
  return richEditorLoad;
}

const MARKDOWN_HINT = "**negrita**, *cursiva*, ~~tachado~~, ++subrayado++, # Título, - lista, 1. lista";

interface Props {
  id?: string;
  mode: EditorModeValue;
  value: string;
  onValueChange: (v: string) => void;
  users: UserOption[];
  placeholder?: string;
  autoFocus?: boolean;
  onCommand?: (kind: MentionCommand) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  textareaClassName?: string;
}

/**
 * Campo de descripción: textarea con Markdown (con barra de formato) o editor con barra, según el perfil.
 *
 * Teclado en el modo Markdown: Tab sangra y Mayús+Tab desangra las líneas de lista bajo el cursor o la selección, y solo
 * cuando se puede (no en el primer elemento, ni si ya cuelga del anterior, ni fuera de una lista). En cualquier otro caso Tab
 * conserva su función de mover el foco, así que el teclado nunca queda atrapado. Los botones de la barra están fuera del orden
 * de Tab; se entra con Alt+F10 (flechas para moverse; Tab o Escape vuelven al texto).
 */
export function DescriptionField({ id, mode, value, onValueChange, users, placeholder, autoFocus, onCommand, onSubmit, onCancel, textareaRef, textareaClassName }: Props) {
  const t = useT();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(textareaRef, () => inner.current!);
  const run = useCallback(
    (edit: (value: string, start: number, end: number) => EditResult | null) => {
      const el = inner.current;
      if (!el) return;
      const result = edit(el.value, el.selectionStart, el.selectionEnd);
      if (result) applyTextareaEdit(el, result, onValueChange);
      el.focus();
    },
    [onValueChange],
  );
  const items = useMemo<FormatItems>(
    () => [
      { title: "Negrita (Ctrl+B)", icon: Bold, run: () => run((v, s, e) => toggleWrap(v, s, e, "**", "**", "negrita")) },
      { title: "Cursiva (Ctrl+I)", icon: Italic, run: () => run((v, s, e) => toggleWrap(v, s, e, "*", "*", "cursiva")) },
      { title: "Subrayado (Ctrl+U)", icon: Underline, run: () => run((v, s, e) => toggleWrap(v, s, e, "++", "++", "subrayado")) },
      { title: "Tachado", icon: Strikethrough, run: () => run((v, s, e) => toggleWrap(v, s, e, "~~", "~~", "tachado")) },
      null,
      { title: "Título", icon: Heading2, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "h2")) },
      { title: "Subtítulo", icon: Heading3, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "h3")) },
      null,
      { title: "Lista", icon: List, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "ul")) },
      { title: "Lista numerada", icon: ListOrdered, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "ol")) },
      { title: "Aumentar sangría (Tab)", icon: IndentIncrease, run: () => run((v, s, e) => indentLines(v, s, e, 1)) },
      { title: "Reducir sangría (Mayús+Tab)", icon: IndentDecrease, run: () => run((v, s, e) => indentLines(v, s, e, -1)) },
      null,
      { title: "Cita", icon: Quote, run: () => run((v, s, e) => toggleLinePrefix(v, s, e, "quote")) },
      { title: "Código", icon: Code, run: () => run((v, s, e) => toggleWrap(v, s, e, "`", "`", "código")) },
      { title: "Bloque de código", icon: Code2, run: () => run(toggleCodeBlock) },
      { title: "Línea horizontal", icon: Minus, run: () => run(insertRule) },
      { title: "Enlace (Ctrl+K)", icon: Link2, run: () => run(insertLink) },
    ],
    [run],
  );

  if (mode === "WYSIWYG") {
    return <WysiwygField fieldRef={inner} id={id} value={value} onValueChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus} users={users} onCommand={onCommand} />;
  }
  return (
    <>
    <div
      ref={root}
      className={cn(FORMAT_BOX_CLASS, "[&_textarea:focus]:border-transparent [&_textarea:focus]:ring-0 [&_textarea]:rounded-t-none [&_textarea]:border-0 [&_textarea]:bg-transparent")}
    >
      <FormatToolbar
        items={items}
        onLeave={() => inner.current?.focus()}
        className={FORMAT_BAR_CLASS}
        trailing={<DictationButton variant="toolbar" tabIndex={-1} within={() => root.current} onText={(s) => insertIntoField(inner.current, s, onValueChange)} />}
      />
      <MentionTextarea
        ref={inner}
        id={id}
        className={textareaClassName ?? "input field-sizing-content min-h-32 font-mono text-[13px]"}
        value={value}
        onValueChange={onValueChange}
        users={users}
        onCommand={onCommand}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onPaste={(e) => {
          // Una tabla copiada de Excel, Google Sheets, Word o una web entra como tabla Markdown (no como texto con tabuladores).
          const md = tablesOnlyMarkdown(e.clipboardData.getData("text/html"));
          if (!md) return;
          e.preventDefault();
          const el = e.currentTarget;
          const start = el.selectionStart, end = el.selectionEnd;
          // La tabla necesita una línea en blanco antes y después para leerse como tabla.
          const before = el.value.slice(0, start), after = el.value.slice(end);
          const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
          const trail = !after || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
          const insert = lead + md + trail;
          const caret = start + lead.length + md.length;
          applyTextareaEdit(el, { value: before + insert + after, start: caret, end: caret }, onValueChange);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          // Alt+F10: lleva el foco a la barra de formato (sus botones se saltan con Tab).
          if (e.key === "F10" && e.altKey) {
            e.preventDefault();
            root.current?.querySelector<HTMLElement>("[role=toolbar] button")?.focus();
            return;
          }
          const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
          const key = e.key.toLowerCase();
          if (mod && (key === "b" || key === "i" || key === "u" || key === "k")) {
            e.preventDefault();
            const mark = ({ b: "**", i: "*", u: "++" } as Record<string, string>)[key];
            run(mark ? (v, s, en) => toggleWrap(v, s, en, mark, mark) : insertLink);
            return;
          }
          // Tab / Mayús+Tab: solo sangran si hay algo que sangrar; si no, siguen su camino (mover el foco).
          if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const el = e.currentTarget;
            const result = indentLines(el.value, el.selectionStart, el.selectionEnd, e.shiftKey ? -1 : 1);
            if (result) {
              e.preventDefault();
              applyTextareaEdit(el, result, onValueChange);
            }
            return;
          }
          if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
    <p className="mt-1 text-xs text-slate-400">{t(MARKDOWN_HINT)}</p>
    </>
  );
}

/**
 * Editor con barra. Si aún no se ha descargado (red lenta), mientras tanto se escribe en un campo de texto provisional:
 * antes solo se veía un hueco gris y las primeras teclas se perdían («Hola equipo» quedaba en «equipo»). Cuando el editor
 * está listo (montado oculto con lo escrito) ocupa su sitio en la misma pasada, con el texto y el foco al final.
 */
function WysiwygField({ fieldRef, id, value, onValueChange, users, placeholder, autoFocus, onCommand, onSubmit, onCancel }: Omit<Props, "mode" | "textareaRef" | "textareaClassName"> & {
  fieldRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [Loaded, setLoaded] = useState<RichEditor | null>(() => richEditor);
  const [provisional, setProvisional] = useState(() => !richEditor);
  // Si empezó con el campo provisional, la estructura no cambia al quitarlo: el editor ya montado (oculto) es el mismo
  // que luego se ve (en otro sitio del árbol, React lo volvería a crear y habría un instante sin campo).
  const [startedProvisional] = useState(provisional);
  const focusOnSwap = useRef<Editor | null>(null);
  useEffect(() => {
    if (Loaded) return;
    let alive = true;
    loadRichEditor().then(
      (E) => alive && setLoaded(() => E),
      () => {}, // sin red: el campo provisional sigue sirviendo (Markdown)
    );
    return () => {
      alive = false;
    };
  }, [Loaded]);
  // Al montar con foco, el cursor va al final del texto (como en el editor).
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!provisional || !autoFocus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);
  useLayoutEffect(() => {
    const ed = focusOnSwap.current;
    if (provisional || !ed) return;
    focusOnSwap.current = null;
    // focus("end") pone el cursor al final, pero el foco lo da en el siguiente fotograma: sin view.focus() la tecla
    // pulsada en ese instante (ya sin el campo provisional) se perdía.
    ed.commands.focus("end");
    ed.view.focus();
  }, [provisional]);
  const onReady = (ed: Editor) => {
    if (!provisional) return;
    // Si se estaba escribiendo en el campo provisional, el foco pasa al editor (ver el efecto de arriba).
    if (typeof document !== "undefined" && document.activeElement === fieldRef.current) focusOnSwap.current = ed;
    setProvisional(false);
  };
  const editor = Loaded && (
    <Loaded id={id} value={value} onChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus && !provisional} users={users} onCommand={onCommand} onReady={onReady} />
  );
  if (!startedProvisional) return editor;
  return (
    <div className={provisional ? "relative" : undefined}>
      {provisional && (
        <div className={FORMAT_BOX_CLASS} data-provisional-editor>
          <div className={cn(FORMAT_BAR_CLASS, "h-9")} aria-hidden />
          <textarea
            ref={fieldRef}
            id={id}
            className="block min-h-32 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none field-sizing-content focus:ring-0"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape" && onCancel) {
                e.preventDefault();
                onCancel();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>
      )}
      {/* El editor ya descargado se monta oculto e inerte (sin foco ni clics) hasta que existe: ver onReady. */}
      {editor && (
        <div className={provisional ? "pointer-events-none absolute inset-x-0 top-0 -z-10 opacity-0" : undefined} inert={provisional}>
          {editor}
        </div>
      )}
    </div>
  );
}
