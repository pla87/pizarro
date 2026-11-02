"use client";

import { Lock, X } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { blockerIsDone, wouldCycle } from "@/lib/blocked";
import { mentionsToPlain } from "@/lib/mentions";
import type { BoardTask } from "@/lib/types";
import { MentionText } from "../ui/MentionText";
import { useBoard, useTasks } from "./context";

const MAX_RESULTS = 8;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * «Bloqueada por»: muestra la tarea que bloquea (con enlace que la abre) y un buscador de las tareas del proyecto para
 * elegirla. Las candidatas salen del tablero ya cargado (mismo proyecto, sin pedir nada más); se excluyen la propia tarea
 * y las que crearían un ciclo. El servidor lo vuelve a comprobar.
 */
export function BlockerPicker({ task, onChange }: { task: BoardTask; onChange: (blocker: { id: string; title: string } | null) => void }) {
  const t = useT();
  const { openTask, columns } = useBoard();
  const tasks = useTasks();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const blocked = task.blockedBy ?? null;
  const live = blocked ? tasks.find((x) => x.id === blocked.id) : undefined;
  const done = blocked ? blockerIsDone(live, columns) : false;
  const title = mentionsToPlain(live?.title ?? blocked?.title ?? "");

  const byId = new Map(tasks.map((x) => [x.id, x]));
  const words = norm(query).split(/\s+/).filter(Boolean);
  const candidates = searching
    ? tasks
        .filter((x) => x.id !== task.id && x.id !== blocked?.id && !wouldCycle(task.id, x.id, (id) => byId.get(id)?.blockedBy?.id))
        .filter((x) => words.every((w) => norm(mentionsToPlain(x.title)).includes(w)))
        .slice(0, MAX_RESULTS)
    : [];

  const pick = (x: BoardTask) => {
    setSearching(false);
    setQuery("");
    onChange({ id: x.id, title: x.title });
  };

  return (
    <div data-blocker-picker>
      {blocked && (
        <div className="flex items-start gap-1.5 text-sm">
          <Lock size={14} className={done ? "mt-1 shrink-0 text-slate-400" : "mt-1 shrink-0 text-amber-600 dark:text-amber-400"} aria-hidden />
          <p className="min-w-0 flex-1 break-words">
            {t("Bloqueada por")}{" "}
            {live ? (
              <button type="button" className="text-left font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => openTask(live.id)} title={t("Abrir la tarea que bloquea")}>
                <MentionText text={live.title} />
              </button>
            ) : (
              // Archivada: ya no está en el tablero, así que no se puede abrir desde aquí.
              <span className="font-medium"><MentionText text={blocked.title} /></span>
            )}
            {done && <span className="ml-1 text-xs text-slate-500">{t("(terminada)")}</span>}
          </p>
          <button type="button" className="btn-icon h-7 w-7 shrink-0" onClick={() => onChange(null)} aria-label={t("Quitar el bloqueo")} title={t("Quitar el bloqueo")}>
            <X size={15} />
          </button>
        </div>
      )}
      {!searching ? (
        <button type="button" className="btn-secondary mt-1 w-full justify-center py-1 text-xs" onClick={() => setSearching(true)} aria-label={blocked ? t("Cambiar la tarea que bloquea") : t("Marcar como bloqueada por otra tarea")}>
          {blocked ? t("Cambiar…") : t("Elegir tarea…")}
        </button>
      ) : (
        <div className="mt-1">
          <input
            autoFocus
            className="input md:py-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setSearching(false);
                setQuery("");
              } else if (e.key === "Enter" && candidates[0]) {
                e.preventDefault();
                pick(candidates[0]);
              }
            }}
            placeholder={t("Buscar tarea del proyecto…")}
            aria-label={t("Buscar tarea del proyecto…")}
            aria-controls={listId}
            maxLength={100}
          />
          <ul id={listId} className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900">
            {candidates.length === 0 && <li className="px-2.5 py-1.5 text-xs text-slate-500">{t("Ninguna tarea coincide.")}</li>}
            {candidates.map((x) => (
              <li key={x.id}>
                <button type="button" className="block w-full truncate px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => pick(x)} title={mentionsToPlain(x.title)}>
                  <MentionText text={x.title} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-1 text-xs text-slate-500 hover:underline" onClick={() => { setSearching(false); setQuery(""); }}>{t("Cancelar")}</button>
        </div>
      )}
    </div>
  );
}
