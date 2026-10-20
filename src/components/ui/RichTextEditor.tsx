"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered, Pilcrow, Strikethrough, Underline } from "lucide-react";
import { createElement, useEffect, useRef } from "react";
import { useT } from "@/i18n/client";
import { looksLikeMarkdown } from "@/lib/markdown-paste";
import { cn } from "./cn";

interface Props {
  /** Markdown actual. El editor es la fuente de verdad mientras se escribe. */
  value: string;
  onChange: (markdown: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Editor con barra de formato (TipTap). Lee y guarda siempre Markdown. */
export function RichTextEditor({ value, onChange, onSubmit, onCancel, id, placeholder, autoFocus, className }: Props) {
  const t = useT();
  // Callbacks siempre actuales sin recrear el editor.
  const handlers = useRef({ onChange, onSubmit, onCancel });
  useEffect(() => {
    handlers.current = { onChange, onSubmit, onCancel };
  });
  // Último Markdown emitido: si `value` cambia desde fuera (p. ej. una plantilla), se recarga.
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      // El subrayado ya viene en StarterKit y se serializa como ++texto++.
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: "prose-md min-h-32 px-3 py-2 text-sm outline-none",
        role: "textbox",
        "aria-multiline": "true",
        ...(placeholder ? { "aria-label": placeholder } : {}),
      },
      // Texto plano con aspecto de Markdown (sin HTML): se interpreta como Markdown.
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        if (!data || data.getData("text/html")) return false;
        const text = data.getData("text/plain");
        if (!text || !looksLikeMarkdown(text)) return false;
        event.preventDefault();
        editorRef.current?.chain().focus().insertContent(text, { contentType: "markdown" }).run();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown();
      lastEmitted.current = md;
      handlers.current.onChange(md);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive("bold") ?? false,
      italic: ed?.isActive("italic") ?? false,
      underline: ed?.isActive("underline") ?? false,
      strike: ed?.isActive("strike") ?? false,
      h2: ed?.isActive("heading", { level: 2 }) ?? false,
      h3: ed?.isActive("heading", { level: 3 }) ?? false,
      p: (ed?.isActive("paragraph") && !ed.isActive("bulletList") && !ed.isActive("orderedList")) ?? false,
      ul: ed?.isActive("bulletList") ?? false,
      ol: ed?.isActive("orderedList") ?? false,
    }),
  });

  const buttons = editor
    ? ([
        ["Negrita (Ctrl+B)", Bold, active?.bold, () => editor.chain().focus().toggleBold().run()],
        ["Cursiva (Ctrl+I)", Italic, active?.italic, () => editor.chain().focus().toggleItalic().run()],
        ["Subrayado (Ctrl+U)", Underline, active?.underline, () => editor.chain().focus().toggleUnderline().run()],
        ["Tachado", Strikethrough, active?.strike, () => editor.chain().focus().toggleStrike().run()],
        null,
        ["Título", Heading2, active?.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
        ["Subtítulo", Heading3, active?.h3, () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
        ["Texto normal", Pilcrow, active?.p, () => editor.chain().focus().setParagraph().run()],
        null,
        ["Lista", List, active?.ul, () => editor.chain().focus().toggleBulletList().run()],
        ["Lista numerada", ListOrdered, active?.ol, () => editor.chain().focus().toggleOrderedList().run()],
      ] as const)
    : [];

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-300 bg-white text-slate-900 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        className,
      )}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape" && handlers.current.onCancel) {
          e.preventDefault();
          handlers.current.onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && handlers.current.onSubmit) {
          e.preventDefault();
          handlers.current.onSubmit();
        }
      }}
    >
      <div role="toolbar" aria-label={t("Formato")} className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 p-1 dark:border-slate-800">
        {buttons.map((b, i) =>
          b === null ? (
            <span key={i} className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
          ) : (
            <button
              key={b[0]}
              type="button"
              title={t(b[0])}
              aria-label={t(b[0]).replace(/ \(.*\)$/, "")}
              aria-pressed={Boolean(b[2])}
              // mousedown no debe quitar el foco al editor
              onMouseDown={(e) => e.preventDefault()}
              onClick={b[3]}
              className={cn("btn-icon h-7 w-7", b[2] && "bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100")}
            >
              {createElement(b[1], { size: 15 })}
            </button>
          ),
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
