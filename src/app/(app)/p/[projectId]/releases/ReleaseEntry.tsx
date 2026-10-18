"use client";

import { ChevronDown, ClipboardCopy, Download } from "lucide-react";
import { useState } from "react";
import { copyText, downloadText } from "@/components/ui/clipboard";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { releaseFileName } from "@/lib/release";

interface Props {
  release: { id: string; title: string; content: string; deployedAt: string; author: string | null; taskCount: number };
}

export function ReleaseEntry({ release }: Props) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const date = new Date(release.deployedAt);
  return (
    <article className="card">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{release.title}</h2>
          <p className="text-xs text-slate-500">
            {date.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
            {release.author && ` · ${release.author}`} · {release.taskCount} tarea(s)
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
          </div>
          <Markdown>{release.content}</Markdown>
        </div>
      )}
    </article>
  );
}
