"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { AtSign, Bold, FileSpreadsheet, FileText, Heading2, Heading3, Italic, List, ListOrdered, Pilcrow, Strikethrough, Underline } from "lucide-react";
import { createElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { ListDeleteFix } from "@/lib/editor-keys";
import { MentionChip } from "@/lib/editor-mention";
import { normalizeEditorMarkdown } from "@/lib/markdown-entities";
import { looksLikeMarkdown } from "@/lib/markdown-paste";
import type { UserOption } from "@/lib/types";
import { Avatar } from "./Avatar";
import { cn } from "./cn";
import type { MentionCommand } from "./MentionTextarea";

type Option =
  | { kind: "user"; id: string; label: string }
  | { kind: "command"; id: MentionCommand; label: string; hint: string };

const COMMANDS: { id: MentionCommand; label: string; hint: string; keys: string[] }[] = [
  { id: "GOOGLE_SHEET", label: "Crear Google Sheet", hint: "Hoja de cálculo nueva enlazada a la tarea", keys: ["sheets", "sheet", "hoja", "excel", "google"] },
  { id: "GOOGLE_DOC", label: "Crear Google Doc", hint: "Documento nuevo enlazado a la tarea", keys: ["docs", "doc", "documento", "google"] },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Popup {
  items: Option[];
  active: number;
  rect: DOMRect | null;
}

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
  /** Personas mencionables con «@». */
  users?: UserOption[];
  /** Si se indica, @docs y @sheets aparecen como comandos. Debe abrir la pestaña de forma síncrona. */
  onCommand?: (command: MentionCommand) => void;
}

/** Editor con barra de formato (TipTap). Lee y guarda siempre Markdown. */
export function RichTextEditor({ value, onChange, onSubmit, onCancel, id, placeholder, autoFocus, className, users, onCommand }: Props) {
  const t = useT();
  // Callbacks siempre actuales sin recrear el editor.
  const handlers = useRef({ onChange, onSubmit, onCancel });
  useEffect(() => {
    handlers.current = { onChange, onSubmit, onCancel };
  });
  // Último Markdown emitido: si `value` cambia desde fuera (p. ej. una plantilla), se recarga.
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  // Sugerencias de «@»: datos actuales sin recrear el editor.
  const mentionData = useRef({ users, onCommand });
  useEffect(() => {
    mentionData.current = { users, onCommand };
  });
  const [popup, setPopup] = useState<Popup | null>(null);
  // Espejo síncrono del popup para el manejo de teclado y clic.
  const popupRef = useRef<{ popup: Popup; run: (o: Option) => void } | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      // El subrayado ya viene en StarterKit y se serializa como ++texto++.
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      Markdown,
      ListDeleteFix,
      // Los refs solo se leen dentro de callbacks (nunca durante el render).
      // eslint-disable-next-line react-hooks/refs
      MentionChip.configure({
        HTMLAttributes: { class: "mention-chip" },
        suggestion: {
          char: "@",
          allowedPrefixes: [" ", "("],
          items: ({ query }): Option[] => {
            const q = norm(query);
            const { users: list = [], onCommand: cmd } = mentionData.current;
            const cmds: Option[] = cmd
              ? COMMANDS.filter((c) => !q || c.keys.some((k) => k.startsWith(q))).map((c) => ({ kind: "command", id: c.id, label: c.label, hint: c.hint }))
              : [];
            const people: Option[] = list
              .filter((u) => !q || norm(u.name).split(/\s+/).some((part) => part.startsWith(q)) || norm(u.name).startsWith(q))
              .slice(0, 6)
              .map((u) => ({ kind: "user", id: u.id, label: u.name }));
            return [...people, ...cmds];
          },
          command: ({ editor: ed, range, props }) => {
            const opt = props as Option;
            if (opt.kind === "user") {
              ed.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id: opt.id, label: opt.label } }, { type: "text", text: " " }]).run();
            } else {
              ed.chain().focus().deleteRange(range).run();
              mentionData.current.onCommand?.(opt.id);
            }
          },
          render: () => {
            const sync = (p: { items: Option[]; clientRect?: (() => DOMRect | null) | null; command: (o: Option) => void }, keepActive: boolean) => {
              const active = keepActive ? Math.min(popupRef.current?.popup.active ?? 0, Math.max(p.items.length - 1, 0)) : 0;
              const next: Popup = { items: p.items, active, rect: p.clientRect?.() ?? null };
              popupRef.current = { popup: next, run: (o) => p.command(o) };
              setPopup(p.items.length ? next : null);
            };
            return {
              onStart: (p) => sync(p as never, false),
              onUpdate: (p) => sync(p as never, true),
              onKeyDown: ({ event }) => {
                const cur = popupRef.current;
                if (!cur || !cur.popup.items.length) return false;
                const { items, active } = cur.popup;
                const move = (next: number) => {
                  cur.popup = { ...cur.popup, active: next };
                  setPopup(cur.popup);
                };
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move((active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
                  return true;
                }
                if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey && !event.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  cur.run(items[active]!);
                  return true;
                }
                if (event.key === "Escape") {
                  // Solo cierra la lista: no debe llegar al onCancel del contenedor.
                  event.stopPropagation();
                  return true;
                }
                return false;
              },
              onExit: () => {
                popupRef.current = null;
                setPopup(null);
              },
            };
          },
        },
      }),
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
      const md = normalizeEditorMarkdown(ed.getMarkdown());
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
      {popup && popup.items.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <ul
            role="listbox"
            style={{
              position: "fixed",
              top: (popup.rect?.bottom ?? 0) + 4,
              left: Math.max(8, Math.min(popup.rect?.left ?? 0, window.innerWidth - 296)),
            }}
            className="z-[100] max-h-64 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {popup.items.map((o, i) => (
              <li key={`${o.kind}-${o.id}`} role="option" aria-selected={i === popup.active}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    popupRef.current?.run(o);
                  }}
                  onMouseEnter={() => {
                    if (popupRef.current) popupRef.current.popup = { ...popupRef.current.popup, active: i };
                    setPopup((p) => (p ? { ...p, active: i } : p));
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    i === popup.active ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-slate-50 dark:hover:bg-slate-800",
                  )}
                >
                  {o.kind === "user" ? (
                    <Avatar id={o.id} name={o.label} />
                  ) : o.id === "GOOGLE_SHEET" ? (
                    <FileSpreadsheet size={20} className="text-emerald-600" />
                  ) : (
                    <FileText size={20} className="text-sky-600" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.kind === "command" ? t(o.label) : o.label}</span>
                    {o.kind === "command" && <span className="block truncate text-xs text-slate-500">{t(o.hint)}</span>}
                  </span>
                </button>
              </li>
            ))}
            <li className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[11px] text-slate-400">
              <AtSign size={11} /> {t("↑↓ para elegir · Enter para insertar")}
            </li>
          </ul>,
          document.body,
        )}
    </div>
  );
}
