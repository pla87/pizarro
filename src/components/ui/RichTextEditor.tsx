"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import { AtSign, Bold, Check, Code, Code2, FileSpreadsheet, FileText, Heading2, Heading3, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, Minus, Pilcrow, Quote, Strikethrough, Underline, Unlink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { ListDeleteFix } from "@/lib/editor-keys";
import { formatExtensions } from "@/lib/editor-extensions";
import { safeMarkdownUrl } from "@/lib/safe-url";
import { MentionChip } from "@/lib/editor-mention";
import { normalizeEditorMarkdown } from "@/lib/markdown-entities";
import { COPY_MARKER } from "@/lib/markdown-copy";
import { markdownFromPaste } from "@/lib/markdown-paste";
import type { UserOption } from "@/lib/types";
import { Avatar } from "./Avatar";
import { cn } from "./cn";
import { registerDragEditor } from "./dragMove";
import { FormatToolbar, type FormatItems } from "./FormatToolbar";
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

/** Sangra (1) o desangra (-1) el elemento de lista o de tareas bajo el cursor; fuera de una lista no hace nada. */
function indent(editor: Editor, direction: 1 | -1) {
  const chain = editor.chain().focus();
  const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
  (direction === 1 ? chain.sinkListItem(type) : chain.liftListItem(type)).run();
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
  // Barra del enlace (dirección): se abre con el botón o con Ctrl+K.
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  // Espejo síncrono del popup para el manejo de teclado y clic.
  const popupRef = useRef<{ popup: Popup; run: (o: Option) => void } | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      ...formatExtensions(),
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
      // Texto plano con aspecto de Markdown: se interpreta como Markdown. El HTML que solo envuelve el texto
      // (div/span/br que añaden los teclados y navegadores móviles) cuenta como texto plano.
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        // Copiado con «Copiar descripción» de Pizarro: se pega el Markdown original (conserva menciones y subrayado).
        const own = data.getData("text/html").includes(COPY_MARKER) ? data.getData("text/plain") : "";
        if (own) {
          try {
            if (editorRef.current?.chain().focus().insertContent(own, { contentType: "markdown" }).run()) {
              event.preventDefault();
              return true;
            }
          } catch {
            // Markdown que el editor no admite: se pega el HTML con el comportamiento normal.
          }
        }
        const text = markdownFromPaste(data.getData("text/plain"), data.getData("text/html"));
        if (!text) return false;
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
    return editor ? registerDragEditor(editor) : undefined;
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
      quote: ed?.isActive("blockquote") ?? false,
      code: ed?.isActive("code") ?? false,
      codeBlock: ed?.isActive("codeBlock") ?? false,
      link: ed?.isActive("link") ?? false,
      inList: (ed?.isActive("listItem") || ed?.isActive("taskItem")) ?? false,
    }),
  });

  const openLink = () => {
    if (!editor) return;
    setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
  };
  const applyLink = () => {
    if (!editor || linkUrl === null) return;
    const raw = linkUrl.trim();
    // Misma lista blanca de direcciones que el render: lo que no pasa se descarta en vez de guardarse inservible.
    const href = raw ? safeMarkdownUrl(/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/") || raw.startsWith("#") ? raw : `https://${raw}`) : "";
    if (!href) editor.chain().focus().unsetLink().run();
    // Sin texto seleccionado (y fuera de un enlace) se inserta la propia dirección como texto del enlace.
    else if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkUrl(null);
  };

  const items: FormatItems = editor
    ? [
        { title: "Negrita (Ctrl+B)", icon: Bold, pressed: active?.bold, run: () => editor.chain().focus().toggleBold().run() },
        { title: "Cursiva (Ctrl+I)", icon: Italic, pressed: active?.italic, run: () => editor.chain().focus().toggleItalic().run() },
        { title: "Subrayado (Ctrl+U)", icon: Underline, pressed: active?.underline, run: () => editor.chain().focus().toggleUnderline().run() },
        { title: "Tachado", icon: Strikethrough, pressed: active?.strike, run: () => editor.chain().focus().toggleStrike().run() },
        null,
        { title: "Título", icon: Heading2, pressed: active?.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { title: "Subtítulo", icon: Heading3, pressed: active?.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
        { title: "Texto normal", icon: Pilcrow, pressed: active?.p, run: () => editor.chain().focus().setParagraph().run() },
        null,
        { title: "Lista", icon: List, pressed: active?.ul, run: () => editor.chain().focus().toggleBulletList().run() },
        { title: "Lista numerada", icon: ListOrdered, pressed: active?.ol, run: () => editor.chain().focus().toggleOrderedList().run() },
        // Tab y Mayús+Tab hacen lo mismo dentro de una lista; fuera de ella los botones no hacen nada.
        { title: "Aumentar sangría (Tab)", icon: IndentIncrease, run: () => indent(editor, 1) },
        { title: "Reducir sangría (Mayús+Tab)", icon: IndentDecrease, run: () => indent(editor, -1) },
        null,
        { title: "Cita", icon: Quote, pressed: active?.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
        { title: "Código", icon: Code, pressed: active?.code, run: () => editor.chain().focus().toggleCode().run() },
        { title: "Bloque de código", icon: Code2, pressed: active?.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
        { title: "Línea horizontal", icon: Minus, run: () => editor.chain().focus().setHorizontalRule().run() },
        { title: "Enlace (Ctrl+K)", icon: Link2, pressed: active?.link, run: openLink },
      ]
    : [];

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-300 bg-white text-slate-900 focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        className,
      )}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        // Alt+F10: lleva el foco a la barra de formato (sus botones se saltan con Tab).
        if (e.key === "F10" && e.altKey) {
          e.preventDefault();
          e.currentTarget.querySelector<HTMLElement>("[role=toolbar] button")?.focus();
          return;
        }
        if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          openLink();
          return;
        }
        if (e.key === "Escape" && linkUrl !== null) {
          // Cierra solo la barra del enlace: no debe llegar al onCancel del contenedor.
          e.preventDefault();
          e.stopPropagation();
          setLinkUrl(null);
          editorRef.current?.commands.focus();
          return;
        }
        if (e.key === "Escape" && handlers.current.onCancel) {
          e.preventDefault();
          handlers.current.onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && handlers.current.onSubmit) {
          e.preventDefault();
          handlers.current.onSubmit();
        }
      }}
    >
      <FormatToolbar items={items} onLeave={() => editorRef.current?.commands.focus()} className="border-b border-slate-200 p-1 dark:border-slate-800" />
      {linkUrl !== null && (
        <div className="flex items-center gap-1 border-b border-slate-200 p-1 dark:border-slate-800">
          <input
            className="input h-7 min-w-0 flex-1 py-0 text-xs"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                applyLink();
              }
            }}
            placeholder="https://"
            aria-label={t("Dirección del enlace")}
            autoFocus
          />
          <button type="button" className="btn-icon h-7 w-7" onClick={applyLink} title={t("Aplicar enlace")} aria-label={t("Aplicar enlace")}><Check size={15} /></button>
          {active?.link && (
            <button type="button" className="btn-icon h-7 w-7" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkUrl(null); }} title={t("Quitar enlace")} aria-label={t("Quitar enlace")}><Unlink size={15} /></button>
          )}
          <button type="button" className="btn-icon h-7 w-7" onClick={() => { setLinkUrl(null); editor?.commands.focus(); }} title={t("Cancelar")} aria-label={t("Cancelar")}><X size={15} /></button>
        </div>
      )}
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
