"use client";

import { useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { insertDictation } from "@/lib/dictation";
import { splitMentions } from "@/lib/mentions";
import type { UserOption } from "@/lib/types";
import { MentionText } from "../ui/MentionText";
import { DictationButton, insertIntoField } from "../ui/DictationButton";
import { MentionTextarea } from "../ui/MentionTextarea";

const TITLE_MAX = 400;
const CLASSES = "field-sizing-content w-full min-w-0 resize-none rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none focus:bg-slate-50 dark:focus:bg-slate-800";

/**
 * Título de la tarea en una línea, con @menciones. Al editar se ve el texto con las menciones tal como
 * se guardan (@[Nombre](user:ID)); al salir, las menciones se pintan como etiquetas con el nombre.
 */
export function TitleField({ value, onChange, onCommit, users }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value?: string) => void;
  users: UserOption[];
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const hasMentions = splitMentions(value).some((p) => typeof p !== "string");
  const ref = useRef<HTMLTextAreaElement>(null);
  const setTitle = (v: string) => onChange(v.replace(/\n/g, ""));
  // Dictado: en el cursor del título; si ahora se ve con las menciones pintadas (sin campo), al final.
  const mic = (
    <DictationButton
      onText={(s) => {
        if (ref.current) insertIntoField(ref.current, s, setTitle);
        else {
          // Sin campo (menciones pintadas) no habrá blur que guarde: se guarda aquí con el valor nuevo.
          const next = (insertDictation(value, value.length, value.length, s)?.value ?? value).replace(/\n/g, "").slice(0, TITLE_MAX);
          onChange(next);
          if (next !== value) onCommit(next);
        }
      }}
    />
  );

  // Un único contenedor: al pasar de campo a menciones pintadas, el botón del micrófono no se vuelve a crear (cortaría el dictado).
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      {hasMentions && !editing ? (
        <button type="button" onClick={() => setEditing(true)} className={`${CLASSES} min-w-0 flex-1 cursor-text text-left break-words`} aria-label={t("Título")}>
          <MentionText text={value} />
        </button>
      ) : (
        <MentionTextarea
          ref={ref}
          value={value}
          onValueChange={setTitle}
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
          maxLength={TITLE_MAX}
          className={CLASSES}
          wrapperClassName="min-w-0 flex-1"
          aria-label={t("Título")}
        />
      )}
      {mic}
    </div>
  );
}
