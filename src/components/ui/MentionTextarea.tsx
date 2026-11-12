"use client";

import { AtSign, FileSpreadsheet, FileText } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import {
  addMentions, applyTextChange, hasMentionIn, mentionTouching, modelFromRaw, modelToRaw, normalizeModel, replaceRange, sliceToRaw,
  type MentionModel, type MentionSpan,
} from "@/lib/mention-edit";
import { mentionRegex, mentionToken } from "@/lib/mentions";
import type { UserOption } from "@/lib/types";
import { normalizeSearch } from "@/lib/search-accents";
import { Avatar } from "./Avatar";
import { cn } from "./cn";

export type MentionCommand = "GOOGLE_DOC" | "GOOGLE_SHEET";

type Option =
  | { kind: "user"; id: string; label: string }
  | { kind: "command"; id: MentionCommand; label: string; hint: string };

const COMMANDS: { id: MentionCommand; label: string; hint: string; keys: string[] }[] = [
  { id: "GOOGLE_SHEET", label: "Crear Google Sheet", hint: "Hoja de cálculo nueva enlazada a la tarea", keys: ["sheets", "sheet", "hoja", "excel", "google"] },
  { id: "GOOGLE_DOC", label: "Crear Google Doc", hint: "Documento nuevo enlazado a la tarea", keys: ["docs", "doc", "documento", "google"] },
];

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  users: UserOption[];
  /** Si se indica, @docs y @sheets aparecen como comandos. Debe abrir la pestaña de forma síncrona. */
  onCommand?: (command: MentionCommand) => void;
  /** Clases del contenedor (por defecto, un bloque normal). */
  wrapperClassName?: string;
  /**
   * Menciones legibles mientras se escribe: en la caja se ve «@Ana» resaltado (sin el id) y `value` / `onValueChange`
   * siguen usando el formato guardado @[Ana](user:ID). Borrar parte de una mención la convierte en texto normal.
   */
  pretty?: boolean;
}

/** Tipo del portapapeles con el trozo copiado en formato guardado (pegarlo en otra caja conserva las menciones). */
const CLIPBOARD_MENTIONS = "application/x-pizarro-mentions";
/** Estados recientes del texto: deshacer y rehacer del navegador los reponen tal cual, con sus menciones. */
const HISTORY_MAX = 100;

/** Edición con `execCommand` (conserva el deshacer del navegador). false si el navegador no la admite. */
function execEdit(el: HTMLTextAreaElement, start: number, end: number, insert: string): boolean {
  el.focus();
  el.setSelectionRange(start, end);
  try {
    return insert ? document.execCommand("insertText", false, insert) : document.execCommand("delete");
  } catch {
    return false;
  }
}

/**
 * Textarea con autocompletado: «@» sugiere personas (se insertan como @[Nombre](user:ID))
 * y, si hay onCommand, los comandos @docs / @sheets.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, users, onCommand, onKeyDown, onBlur, onPaste, onCopy, onCut, onScroll, className, wrapperClassName, pretty = false, ...rest },
  ref,
) {
  const t = useT();
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  // Posición del cursor tras insertar una mención: se aplica en cuanto React pinta el nuevo
  // valor (antes de la siguiente tecla); con requestAnimationFrame se desordenaba el texto.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inner.current) {
      inner.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  // --- Modo «pretty»: el textarea muestra model.text; las menciones (con su id) van en model.mentions. ---
  const [model, setModel] = useState<MentionModel>(() => modelFromRaw(value));
  const [modelRaw, setModelRaw] = useState(value);
  // Cambio desde fuera (enviar vacía la caja, se recupera un borrador, se añade un enlace): se vuelve a leer.
  if (pretty && value !== modelRaw) {
    setModelRaw(value);
    setModel(modelFromRaw(value));
  }
  // El último modelo, para los eventos que llegan seguidos sin que React haya vuelto a pintar (execCommand).
  const modelRef = useRef(model);
  useLayoutEffect(() => {
    modelRef.current = model;
  }, [model]);
  const history = useRef(new Map<string, MentionSpan[]>());
  const pendingSpans = useRef<MentionSpan[] | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  const commit = (next: MentionModel, caret?: number) => {
    // Lo que tenga forma de mención guardada (p. ej. escrita a mano) pasa a ser mención: es lo que se guardaría.
    const normal = normalizeModel(next);
    if (normal !== next && caret !== undefined) pendingCaret.current = Math.max(0, caret + normal.text.length - next.text.length);
    else if (caret !== undefined && inner.current?.value !== normal.text) pendingCaret.current = caret;
    const h = history.current;
    h.delete(normal.text);
    h.set(normal.text, normal.mentions);
    if (h.size > HISTORY_MAX) h.delete(h.keys().next().value as string);
    modelRef.current = normal;
    const raw = modelToRaw(normal);
    setModel(normal);
    setModelRaw(raw);
    onValueChange(raw);
  };

  /** Sustituye [start, end) por `raw` (formato guardado) conservando el deshacer del navegador si se puede. */
  const replaceWith = (el: HTMLTextAreaElement, start: number, end: number, raw: string) => {
    const ins = modelFromRaw(raw);
    if (start === end && !ins.text) return;
    const before = el.value;
    pendingSpans.current = ins.mentions.map((m) => ({ ...m, start: m.start + start, end: m.end + start }));
    const ok = execEdit(el, start, end, ins.text);
    pendingSpans.current = null;
    if (ok && el.value !== before) return;
    // Sin execCommand: se cambia el valor directamente (se pierde el deshacer de este paso).
    const r = replaceRange(modelRef.current, start, end, raw);
    commit(r.model, r.caret);
  };

  const options = useMemo<Option[]>(() => {
    if (!query) return [];
    const q = normalizeSearch(query.text);
    const cmds: Option[] = onCommand
      ? COMMANDS.filter((c) => !q || c.keys.some((k) => k.startsWith(q))).map((c) => ({ kind: "command", id: c.id, label: c.label, hint: c.hint }))
      : [];
    const people: Option[] = users
      .filter((u) => !q || normalizeSearch(u.name).split(/\s+/).some((part) => part.startsWith(q)) || normalizeSearch(u.name).startsWith(q))
      .slice(0, 6)
      .map((u) => ({ kind: "user", id: u.id, label: u.name }));
    return [...people, ...cmds];
  }, [query, users, onCommand]);

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart;
    const before = el.value.slice(0, caret);
    const m = /(^|[\s(])@([\p{L}\p{N}_.-]{0,30})$/u.exec(before);
    const start = m ? caret - m[2]!.length - 1 : -1;
    // Con el cursor al final de una mención ya hecha («@Ana|») no se vuelve a sugerir.
    if (m && !(pretty && modelRef.current.mentions.some((x) => x.start === start))) {
      setQuery({ start, text: m[2]! });
      setActive(0);
    } else setQuery(null);
  };

  const choose = (opt: Option) => {
    if (!query || !inner.current) return;
    const el = inner.current;
    const end = el.selectionStart;
    if (pretty) {
      setQuery(null);
      replaceWith(el, query.start, end, opt.kind === "user" ? mentionToken(opt.label, opt.id) + " " : "");
      if (opt.kind === "command") onCommand?.(opt.id);
      return;
    }
    const insert = opt.kind === "user" ? mentionToken(opt.label, opt.id) + " " : "";
    const next = value.slice(0, query.start) + insert + value.slice(end);
    onValueChange(next);
    setQuery(null);
    pendingCaret.current = query.start + insert.length;
    el.focus();
    if (opt.kind === "command") onCommand?.(opt.id);
  };

  const showBackdrop = pretty && model.mentions.length > 0;

  /** Copiar o cortar un trozo con menciones: texto legible para otras aplicaciones y el formato guardado para Pizarro. */
  const copyMentions = (e: React.ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end || !hasMentionIn(modelRef.current, start, end)) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", modelRef.current.text.slice(start, end));
    e.clipboardData.setData(CLIPBOARD_MENTIONS, sliceToRaw(modelRef.current, start, end));
    if (cut) replaceWith(el, start, end, "");
  };

  return (
    <div className={cn("relative", wrapperClassName)}>
      {showBackdrop && (
        // Capa detrás del textarea (transparente) con el mismo texto invisible y las menciones resaltadas.
        <div
          ref={backdrop}
          aria-hidden
          className={cn(className, "pointer-events-none absolute inset-0 overflow-hidden text-transparent!", rest.disabled && "bg-slate-100 dark:bg-slate-800/60")}
          style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
          data-mention-backdrop=""
        >
          {backdropParts(model)}
        </div>
      )}
      <textarea
        ref={inner}
        value={pretty ? model.text : value}
        className={cn(className, showBackdrop && "relative bg-transparent!")}
        onScroll={(e) => {
          if (backdrop.current) {
            backdrop.current.scrollTop = e.currentTarget.scrollTop;
            backdrop.current.scrollLeft = e.currentTarget.scrollLeft;
          }
          onScroll?.(e);
        }}
        onPaste={(e) => {
          onPaste?.(e);
          if (!pretty || e.defaultPrevented) return;
          const custom = e.clipboardData.getData(CLIPBOARD_MENTIONS);
          const plain = e.clipboardData.getData("text/plain");
          const raw = custom || (mentionRegex().test(plain) ? plain : "");
          if (!raw) return;
          e.preventDefault();
          const el = e.currentTarget;
          const room = el.maxLength >= 0 ? el.maxLength - (el.value.length - (el.selectionEnd - el.selectionStart)) : Infinity;
          if (modelFromRaw(raw).text.length > room) return;
          replaceWith(el, el.selectionStart, el.selectionEnd, raw);
        }}
        onCopy={(e) => {
          onCopy?.(e);
          if (pretty && !e.defaultPrevented) copyMentions(e, false);
        }}
        onCut={(e) => {
          onCut?.(e);
          if (pretty && !e.defaultPrevented) copyMentions(e, true);
        }}
        onChange={(e) => {
          if (!pretty) {
            onValueChange(e.target.value);
            detect(e.target);
            return;
          }
          const el = e.target;
          const text = el.value;
          const inputType = (e.nativeEvent as InputEvent).inputType;
          const cached = inputType === "historyUndo" || inputType === "historyRedo" ? history.current.get(text) : undefined;
          let next: MentionModel = cached ? { text, mentions: cached } : applyTextChange(modelRef.current, text, el.selectionEnd);
          if (!cached && pendingSpans.current) next = addMentions(next, pendingSpans.current);
          pendingSpans.current = null;
          commit(next, el.selectionEnd);
          detect(el);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onBlur={(e) => {
          setTimeout(() => setQuery(null), 150);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          // Retroceso al final de una mención (o Supr al principio) la borra entera.
          if (pretty && (e.key === "Backspace" || e.key === "Delete") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) {
            const el = e.currentTarget;
            const m = el.selectionStart === el.selectionEnd ? mentionTouching(modelRef.current, el.selectionStart, e.key === "Backspace" ? "backward" : "forward") : undefined;
            if (m) {
              e.preventDefault();
              replaceWith(el, m.start, m.end, "");
              setQuery(null);
              return;
            }
          }
          if (query && options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              choose(options[active]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
      {query && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 z-40 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {options.map((o, i) => (
            <li key={`${o.kind}-${o.id}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  i === active ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-slate-50 dark:hover:bg-slate-800",
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
        </ul>
      )}
    </div>
  );
});

/** Contenido de la capa de resaltado: el texto tal cual (invisible) y cada mención con su fondo. */
function backdropParts(model: MentionModel): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of model.mentions) {
    if (m.start > last) out.push(model.text.slice(last, m.start));
    out.push(
      <mark key={m.start} className="rounded-sm bg-brand-100 text-transparent ring-2 ring-brand-100 dark:bg-brand-500/35 dark:ring-brand-500/35" data-mention={m.id}>
        {model.text.slice(m.start, m.end)}
      </mark>,
    );
    last = m.end;
  }
  // Un salto de línea final no ocupa línea en un div: se añade un espacio para que las alturas coincidan.
  out.push(model.text.slice(last) + (model.text.endsWith("\n") ? " " : ""));
  return out;
}
