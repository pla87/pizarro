"use client";

import { AtSign, FileSpreadsheet, FileText } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { mentionToken } from "@/lib/mentions";
import type { UserOption } from "@/lib/types";
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

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  users: UserOption[];
  /** Si se indica, @docs y @sheets aparecen como comandos. Debe abrir la pestaña de forma síncrona. */
  onCommand?: (command: MentionCommand) => void;
}

/**
 * Textarea con autocompletado: «@» sugiere personas (se insertan como @[Nombre](user:ID))
 * y, si hay onCommand, los comandos @docs / @sheets.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, users, onCommand, onKeyDown, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const options = useMemo<Option[]>(() => {
    if (!query) return [];
    const q = norm(query.text);
    const cmds: Option[] = onCommand
      ? COMMANDS.filter((c) => !q || c.keys.some((k) => k.startsWith(q))).map((c) => ({ kind: "command", id: c.id, label: c.label, hint: c.hint }))
      : [];
    const people: Option[] = users
      .filter((u) => !q || norm(u.name).split(/\s+/).some((part) => part.startsWith(q)) || norm(u.name).startsWith(q))
      .slice(0, 6)
      .map((u) => ({ kind: "user", id: u.id, label: u.name }));
    return [...people, ...cmds];
  }, [query, users, onCommand]);

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart;
    const before = el.value.slice(0, caret);
    const m = /(^|[\s(])@([\p{L}\p{N}_.-]{0,30})$/u.exec(before);
    if (m) {
      setQuery({ start: caret - m[2]!.length - 1, text: m[2]! });
      setActive(0);
    } else setQuery(null);
  };

  const choose = (opt: Option) => {
    if (!query || !inner.current) return;
    const el = inner.current;
    const end = el.selectionStart;
    const insert = opt.kind === "user" ? mentionToken(opt.label, opt.id) + " " : "";
    const next = value.slice(0, query.start) + insert + value.slice(end);
    onValueChange(next);
    setQuery(null);
    const caret = query.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
    if (opt.kind === "command") onCommand?.(opt.id);
  };

  return (
    <div className="relative">
      <textarea
        ref={inner}
        value={value}
        className={className}
        onChange={(e) => {
          onValueChange(e.target.value);
          detect(e.target);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (query && options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
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
                  <span className="block truncate font-medium">{o.label}</span>
                  {o.kind === "command" && <span className="block truncate text-xs text-slate-500">{o.hint}</span>}
                </span>
              </button>
            </li>
          ))}
          <li className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[11px] text-slate-400">
            <AtSign size={11} /> ↑↓ para elegir · Enter para insertar
          </li>
        </ul>
      )}
    </div>
  );
});
