"use client";

import { ChevronDown, ClipboardCopy, Download, FileArchive, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteRelease, deleteReleaseAttachments } from "@/actions/releases";
import { copyText, downloadText } from "@/components/ui/clipboard";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { releaseFileName } from "@/lib/release";
import { formatDate } from "@/lib/format";

interface Props {
  release: { id: string; number: number; title: string; content: string; deployedAt: string; author: string | null; taskCount: number; attachments: string[] };
}

export function ReleaseEntry({ release }: Props) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState(release.attachments);
  const [removed, setRemoved] = useState(false);
  const date = new Date(release.deployedAt);

  const remove = async () => {
    if (!window.confirm(`¿Borrar la release «${release.title}» del histórico? Se borran también sus adjuntos. Las tareas no cambian.`)) return;
    setBusy(true);
    const res = await deleteRelease(release.id);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setRemoved(true);
    toast("Release borrada");
    router.refresh();
  };

  const removeAttachments = async () => {
    if (!window.confirm(`¿Borrar los ${attachments.length} adjuntos de esta release? El texto se conserva.`)) return;
    setBusy(true);
    const res = await deleteReleaseAttachments(release.id);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setAttachments([]);
    toast("Adjuntos borrados");
    router.refresh();
  };

  if (removed) return null;
  return (
    <article className="card">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">
            <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">R{release.number}</span>
            {release.title}
          </h2>
          <p className="text-xs text-slate-500">
            {formatDate(date, "dateTime")}
            {release.author && ` · ${release.author}`} · {release.taskCount === 1 ? "1 tarea" : `${release.taskCount} tareas`}
            {attachments.length > 0 && ` · ${attachments.length === 1 ? "1 adjunto" : `${attachments.length} adjuntos`}`}
          </p>
        </div>
        <ChevronDown size={18} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn-secondary py-1.5" onClick={async () => toast(await copyText(release.content) ? "Copiado al portapapeles" : "No se pudo copiar")}>
              <ClipboardCopy size={15} /> Copiar
            </button>
            <button className="btn-secondary py-1.5" onClick={() => downloadText(release.content, releaseFileName(date, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary py-1.5" onClick={() => downloadText(release.content, releaseFileName(date, "txt"), "text/plain")}>
              <Download size={15} /> .txt
            </button>
            <button className="btn-secondary py-1.5 text-red-600 dark:text-red-400 sm:ml-auto" disabled={busy} onClick={remove}>
              <Trash2 size={15} /> Borrar release
            </button>
          </div>
          {attachments.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Adjuntos ({attachments.length})</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <a className="btn-secondary py-1.5" href={`/api/releases/${release.id}/attachments`} download>
                    <FileArchive size={15} /> Descargar adjuntos
                  </a>
                  <button className="btn-secondary py-1.5 text-red-600 dark:text-red-400" disabled={busy} onClick={removeAttachments}>
                    <Trash2 size={15} /> Borrar adjuntos
                  </button>
                </div>
              </div>
              <p className="mt-1 break-words text-xs text-slate-500">{attachments.join(", ")}</p>
            </div>
          )}
          <Markdown>{release.content}</Markdown>
        </div>
      )}
    </article>
  );
}
