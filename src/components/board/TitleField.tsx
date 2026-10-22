"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { splitMentions } from "@/lib/mentions";
import type { UserOption } from "@/lib/types";
import { MentionText } from "../ui/MentionText";
import { MentionTextarea } from "../ui/MentionTextarea";

const CLASSES = "field-sizing-content w-full min-w-0 resize-none rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none focus:bg-slate-50 dark:focus:bg-slate-800";

/**
 * Título de la tarea en una línea, con @menciones. Al editar se ve el texto con las menciones tal como
 * se guardan (@[Nombre](user:ID)); al salir, las menciones se pintan como etiquetas con el nombre.
 */
export function TitleField({ value, onChange, onCommit, users }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  users: UserOption[];
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const hasMentions = splitMentions(value).some((p) => typeof p !== "string");

  if (hasMentions && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={`${CLASSES} min-w-0 flex-1 cursor-text text-left break-words`} aria-label={t("Título")}>
        <MentionText text={value} />
      </button>
    );
  }
  return (
    <MentionTextarea
      value={value}
      onValueChange={(v) => onChange(v.replace(/\n/g, ""))}
      users={users}
      autoFocus={editing}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      rows={1}
      maxLength={400}
      className={CLASSES}
      wrapperClassName="min-w-0 flex-1"
      aria-label={t("Título")}
    />
  );
}
