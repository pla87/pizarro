"use client";

import dynamic from "next/dynamic";
import { useT } from "@/i18n/client";
import { MentionTextarea, type MentionCommand } from "./MentionTextarea";

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
  maxLength?: number;
  autoFocus?: boolean;
  onCommand?: (kind: MentionCommand) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  textareaClassName?: string;
}

/** Campo de descripción: textarea con Markdown o editor con barra de formato, según el perfil. */
export function DescriptionField({ id, mode, value, onValueChange, users, placeholder, maxLength, autoFocus, onCommand, onSubmit, onCancel, textareaRef, textareaClassName }: Props) {
  const t = useT();
  if (mode === "WYSIWYG") {
    return <RichTextEditor id={id} value={value} onChange={onValueChange} onSubmit={onSubmit} onCancel={onCancel} placeholder={placeholder} autoFocus={autoFocus} users={users} onCommand={onCommand} />;
  }
  return (
    <>
      <MentionTextarea
        ref={textareaRef}
        id={id}
        className={textareaClassName ?? "input field-sizing-content min-h-32 font-mono text-[13px]"}
        value={value}
        onValueChange={onValueChange}
        users={users}
        onCommand={onCommand}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
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
    </>
  );
}
