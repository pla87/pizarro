"use client";

import dynamic from "next/dynamic";
import { Bold, Code, Code2, Heading2, Heading3, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Minus, Quote, Strikethrough, Underline } from "lucide-react";
import { useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { useT } from "@/i18n/client";
import { indentLines, insertLink, insertRule, toggleCodeBlock, toggleLinePrefix, toggleWrap, type EditResult } from "@/lib/markdown-edit";
import { FormatToolbar, type FormatItems } from "./FormatToolbar";
import { MentionTextarea, type MentionCommand } from "./MentionTextarea";
import { applyTextareaEdit } from "./textarea-edit";

// El editor con barra (TipTap) pesa: solo se descarga para quien lo usa (el tablero lo precarga en reposo).
const RichTextEditor = dynamic(() => import("./RichTextEditor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 animate-pulse rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" />,
});
import type { EditorModeValue, UserOption } from "@/lib/types";

export const MARKDOWN_HINT = "**negrita**, *cursiva*, ~~tachado~~, ++subrayado++, # Título, - lista, 1. lista";

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
    return <RichTextEditor id={id} value={value} onChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus} users={users} onCommand={onCommand} />;
  }
  return (
    <div ref={root} className="contents">
      <FormatToolbar items={items} onLeave={() => inner.current?.focus()} className="mb-1" />
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
      <p className="mt-1 text-xs text-slate-400">{t(MARKDOWN_HINT)}</p>
    </div>
  );
}
