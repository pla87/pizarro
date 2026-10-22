"use client";

import { ListFilter } from "lucide-react";
import { useState } from "react";
import { isWhite, kindBadgeStyle, onColor } from "@/lib/constants";
import type { KindOption, LabelOption, UserOption } from "@/lib/types";
import { useT } from "@/i18n/client";
import { cn } from "../ui/cn";
import { useEscapeClose } from "../ui/useEscapeClose";
import { activeFilterCount, EMPTY_FILTERS, NO_ASSIGNEE, type BoardFilters } from "./filters";

interface Props {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  labels: LabelOption[];
  kinds: KindOption[];
  users: UserOption[];
  currentUserId: string;
  className?: string;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Desplegable «Filtros» junto al buscador del tablero: botón de icono con un contador cuando hay filtros activos. */
export function FilterMenu({ filters, onChange, labels, kinds, users, currentUserId, className }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEscapeClose(open, () => setOpen(false));
  const count = activeFilterCount(filters);
  const set = (patch: Partial<BoardFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        className={cn("btn-icon relative h-8 w-8", count > 0 && "text-brand-600")}
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? t("Filtros ({n} activos)", { n: count }) : t("Filtros")}
        aria-expanded={open}
        title={t("Filtros")}
      >
        <ListFilter size={16} />
        {count > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] leading-none font-semibold text-on-brand">
            {count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-30 mt-1 max-h-[min(32rem,70vh)] w-72 max-w-[calc(100vw-1.5rem)] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap gap-1.5">
              <Chip on={filters.mine} onClick={() => set({ mine: !filters.mine })}>{t("Mis tareas")}</Chip>
              <Chip on={filters.overdue} onClick={() => set({ overdue: !filters.overdue })}>{t("Vencidas")}</Chip>
              <Chip on={filters.week} onClick={() => set({ week: !filters.week })}>{t("Esta semana")}</Chip>
            </div>
            {labels.length > 0 && (
              <Group title={t("Etiqueta")}>
                {labels.map((l) => {
                  const on = filters.labelIds.includes(l.id);
                  return (
                    <Chip
                      key={l.id}
                      on={on}
                      onClick={() => set({ labelIds: toggle(filters.labelIds, l.id) })}
                      style={on ? { backgroundColor: l.color, color: onColor(l.color), boxShadow: isWhite(l.color) ? "inset 0 0 0 1px rgb(0 0 0 / 0.2)" : undefined } : undefined}
                    >
                      {l.name}
                    </Chip>
                  );
                })}
              </Group>
            )}
            {kinds.length > 1 && (
              <Group title={t("Tipo")}>
                {kinds.map((k) => {
                  const on = filters.kindIds.includes(k.id);
                  return (
                    <Chip key={k.id} on={on} onClick={() => set({ kindIds: toggle(filters.kindIds, k.id) })} style={on ? kindBadgeStyle(k.color) : undefined} kind>
                      {k.name}
                    </Chip>
                  );
                })}
              </Group>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="board-filter-assignee">{t("Responsable")}</label>
              <select id="board-filter-assignee" className="input py-1" value={filters.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
                <option value="">{t("Cualquiera")}</option>
                <option value={NO_ASSIGNEE}>{t("Sin asignar")}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.id === currentUserId ? t("{name} (yo)", { name: u.name }) : u.name}</option>)}
              </select>
            </div>
            {count > 0 && (
              <button type="button" className="w-full rounded-md py-1 text-center text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" onClick={() => onChange(EMPTY_FILTERS)}>
                {t("Limpiar filtros")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children, style, kind = false }: { on: boolean; onClick: () => void; children: React.ReactNode; style?: React.CSSProperties; kind?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={style}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        on ? (kind ? "kind-badge" : style ? "" : "bg-brand-600 text-on-brand") : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}
