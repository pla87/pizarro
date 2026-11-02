"use client";

import { ArchiveRestore, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getArchivedTasks, restoreTask } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import type { ArchivedTask } from "@/lib/types";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";
import { formatDate } from "@/lib/format";
import { MentionText } from "../ui/MentionText";

/** Tareas archivadas del proyecto: consulta y recuperación. */
export function ArchivedDialog({ onClose }: { onClose: () => void }) {
  const board = useBoard();
  const toast = useToast();
  const t = useT();
  const locale = useIntlLocale();
  const dateFmt = (iso: string) => formatDate(iso, "dateShort", locale);
  const [items, setItems] = useState<ArchivedTask[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const q = query.trim();
  // Búsqueda vigente: una respuesta de «Ver más» que llega tras cambiar la búsqueda se descarta.
  const qRef = useRef(q);
  useEffect(() => {
    qRef.current = q;
  }, [q]);

  // La búsqueda se hace en el servidor (con una pequeña espera al teclear); el listado va por páginas.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      getArchivedTasks(board.project.id, { query: q }).then((res) => {
        if (!alive) return;
        if (!res.ok) {
          toast(res.error, "error");
          setItems([]);
          setNext(null);
        } else {
          setItems(res.data.items);
          setNext(res.data.nextCursor);
        }
      });
    }, q ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.project.id, q]);

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    const asked = q;
    const res = await getArchivedTasks(board.project.id, { query: asked, cursor: next });
    setLoadingMore(false);
    if (qRef.current !== asked) return;
    if (!res.ok) return toast(res.error, "error");
    setItems((prev) => {
      const have = new Set((prev ?? []).map((it) => it.id));
      return [...(prev ?? []), ...res.data.items.filter((it) => !have.has(it.id))];
    });
    setNext(res.data.nextCursor);
  };

  const filtered = items;

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
        <p className="py-6 text-center text-sm text-slate-500">{q ? t("Ninguna tarea coincide.") : t("No hay tareas archivadas.")}</p>
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
      {next && (
        <div className="flex justify-center pt-3">
          <button className="btn-ghost text-sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore && <Loader2 size={14} className="animate-spin" />} {t("Cargar más")}
          </button>
        </div>
      )}
    </Modal>
  );
}
