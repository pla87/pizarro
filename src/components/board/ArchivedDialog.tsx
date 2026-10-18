"use client";

import { ArchiveRestore, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getArchivedTasks, restoreTask } from "@/actions/tasks";
import type { ArchivedTask } from "@/lib/types";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("es-ES");

/** Tareas archivadas del proyecto: consulta y recuperación. */
export function ArchivedDialog({ onClose }: { onClose: () => void }) {
  const board = useBoard();
  const toast = useToast();
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
    return items.filter((t) => t.title.toLowerCase().includes(q) || t.releases.some((r) => r.title.toLowerCase().includes(q)));
  }, [items, query]);

  const restore = async (id: string) => {
    setBusy(id);
    const res = await board.track(restoreTask(id));
    setBusy(null);
    if (!res.ok) return toast(res.error, "error");
    board.upsertTask(res.data.task);
    setItems((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    toast(`Tarea recuperada en «${res.data.columnName}»`);
  };

  return (
    <Modal open onClose={onClose} title="Tareas archivadas" size="lg" panelClassName="sm:h-[40rem]">
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          data-autofocus
          className="input w-full pl-9"
          placeholder="Filtrar por título o release…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered === null ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{items?.length ? "Ninguna tarea coincide." : "No hay tareas archivadas."}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {filtered.map((t) => (
            <li key={t.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <TypeBadge kind={board.kindById.get(t.kindId)} />
                  <span className="min-w-0 truncate text-sm font-medium">{t.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>Archivada el {dateFmt(t.archivedAt)}</span>
                  <span>· {t.columnName ? `de «${t.columnName}»` : "columna borrada"}</span>
                  {t.releases.map((r) => (
                    <span key={r.id} className="badge" title={`Desplegada el ${dateFmt(r.deployedAt)}`}>En release: {r.title}</span>
                  ))}
                </div>
              </div>
              <button className="btn-ghost shrink-0 py-1 text-xs" disabled={busy === t.id} onClick={() => restore(t.id)}>
                {busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />} Recuperar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
