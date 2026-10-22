"use client";

import { ArchiveRestore, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getArchivedTasks, restoreTask } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import type { ArchivedTask } from "@/lib/types";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";
import { formatDate } from "@/lib/format";
import { MentionText } from "../ui/MentionText";
import { mentionsToPlain } from "@/lib/mentions";

/** Tareas archivadas del proyecto: consulta y recuperación. */
export function ArchivedDialog({ onClose }: { onClose: () => void }) {
  const board = useBoard();
  const toast = useToast();
  const t = useT();
  const locale = useIntlLocale();
  const dateFmt = (iso: string) => formatDate(iso, "dateShort", locale);
  const [items, setItems] = useState<ArchivedTask[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getArchivedTasks(board.project.id).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        toast(res.error, "error");
        setItems([]);
      } else setItems(res.data);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.project.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !items) return items;
    return items.filter((it) => mentionsToPlain(it.title).toLowerCase().includes(q) || it.releases.some((r) => r.title.toLowerCase().includes(q)));
  }, [items, query]);

  const restore = async (id: string) => {
    setBusy(id);
    const res = await board.track(restoreTask(id));
    setBusy(null);
    if (!res.ok) return toast(res.error, "error");
    board.upsertTask(res.data.task);
    setItems((prev) => prev?.filter((it) => it.id !== id) ?? prev);
    toast(t("Tarea recuperada en «{name}»", { name: res.data.columnName }));
  };

  return (
    <Modal open onClose={onClose} title={t("Tareas archivadas")} size="lg" panelClassName="sm:h-[40rem]">
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          data-autofocus
          className="input w-full pl-9"
          placeholder={t("Filtrar por título o release…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered === null ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{items?.length ? t("Ninguna tarea coincide.") : t("No hay tareas archivadas.")}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {filtered.map((task) => (
            <li key={task.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <TypeBadge kind={board.kindById.get(task.kindId)} />
                  <span className="min-w-0 truncate text-sm font-medium"><MentionText text={task.title} /></span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>{t("Archivada el {date}", { date: dateFmt(task.archivedAt) })}</span>
                  <span>· {task.columnName ? t("de «{name}»", { name: task.columnName }) : t("columna borrada")}</span>
                  {task.releases.map((r) => (
                    <span key={r.id} className="badge" title={t("Desplegada el {date}", { date: dateFmt(r.deployedAt) })}>{t("En release: {title}", { title: r.title })}</span>
                  ))}
                </div>
              </div>
              <button className="btn-ghost shrink-0 py-1 text-xs" disabled={busy === task.id} onClick={() => restore(task.id)}>
                {busy === task.id ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />} {t("Recuperar")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
