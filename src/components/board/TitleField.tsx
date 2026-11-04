"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { insertDictation } from "@/lib/dictation";
import { MAX_TITLE } from "@/lib/constants";
import { splitMentions } from "@/lib/mentions";
import { clampTitle } from "@/lib/title-clamp";
import type { UserOption } from "@/lib/types";
import { MentionText } from "../ui/MentionText";
import { DictationButton, insertIntoField } from "../ui/DictationButton";
import { MentionTextarea } from "../ui/MentionTextarea";
import { pasteAsOneLine } from "../ui/textarea-edit";
import { useToast } from "../ui/Toast";
import { cn } from "../ui/cn";
import { overTitleLimit, TITLE_INPUT_LIMIT, TITLE_INVALID_CLASSES, TitleLimitHint } from "./TitleLimit";

// pr-9: deja sitio al micrófono, que va dentro del campo, a la derecha.
const CLASSES = "field-sizing-content w-full min-w-0 resize-none rounded-md bg-transparent py-0.5 pr-9 pl-1 text-lg font-semibold outline-none focus:bg-slate-50 dark:focus:bg-slate-800";

const NARROW = "(max-width: 639px)";
/** true por debajo de sm (móvil). En el servidor, false. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

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
  const toast = useToast();
  const hintId = useId();
  const [editing, setEditing] = useState(false);
  const narrow = useNarrow();
  const over = overTitleLimit(value);
  const hasMentions = splitMentions(value).some((p) => typeof p !== "string");
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Un salto de línea (dictado, arrastre) es un espacio: así no se pegan dos palabras.
  const setTitle = (v: string) => onChange(v.replace(/[ \t]*\n\s*/g, " "));
  /** Título listo para guardar: si pasa del máximo se recorta (sin partir emojis ni menciones) y se avisa. */
  const commitClamped = (raw: string): string => {
    const c = clampTitle(raw.trim());
    if (c.clipped) toast(t("Título recortado a {max} caracteres", { max: MAX_TITLE }));
    return c.value;
  };
  // Dictado: en el cursor del título; si ahora se ve con las menciones pintadas (sin campo), al final.
  const mic = (
    <DictationButton
      onText={(s) => {
        if (ref.current) insertIntoField(ref.current, s, setTitle);
        else {
          // Sin campo (menciones pintadas) no habrá blur que guarde: se guarda aquí con el valor nuevo.
          const raw = (insertDictation(value, value.length, value.length, s)?.value ?? value).replace(/\n/g, "");
          const next = commitClamped(raw);
          onChange(next);
          if (next !== value) onCommit(next);
        }
      }}
      within={() => box.current}
      placement="inside"
    />
  );

  // Un único contenedor: al pasar de campo a menciones pintadas, el botón del micrófono no se vuelve a crear (cortaría el dictado).
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      {!editing && (hasMentions || narrow) ? (
        // En móvil, sin editar, el título ocupa como mucho 2 líneas; al tocarlo se edita y se ve entero.
        <button type="button" onClick={() => setEditing(true)} className={`${CLASSES} block min-w-0 cursor-text text-left break-words max-sm:line-clamp-2`} aria-label={t("Título")}>
          <MentionText text={value} />
        </button>
      ) : (
        <MentionTextarea
          ref={ref}
          value={value}
          onValueChange={setTitle}
          onPaste={(e) => pasteAsOneLine(e, setTitle)}
          users={users}
          autoFocus={editing}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            if (!overTitleLimit(value)) return onCommit();
            // Se recorta antes de guardar: el campo y lo guardado coinciden, y se avisa.
            const next = commitClamped(value);
            onChange(next);
            onCommit(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={1}
          maxLength={TITLE_INPUT_LIMIT}
          className={cn(CLASSES, over && TITLE_INVALID_CLASSES)}
          aria-invalid={over || undefined}
          aria-describedby={over ? hintId : undefined}
          wrapperClassName="min-w-0"
          aria-label={t("Título")}
        />
      )}
      {/* En móvil, el micrófono solo sale al editar el título (absoluto: no mueve nada ni quita el foco). */}
      {(!narrow || editing) && mic}
      <TitleLimitHint id={hintId} value={value} className="pl-1" />
    </div>
  );
}
