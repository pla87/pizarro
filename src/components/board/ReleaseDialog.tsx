"use client";

import { ArrowLeft, Check, ClipboardCopy, Download, Eye, FileText, Loader2, Pencil, Rocket } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { deployRelease } from "@/actions/releases";
import { buildReleaseMarkdown, isoDate, releaseFileName } from "@/lib/release";
import type { BoardTask } from "@/lib/types";
import { copyText, downloadText } from "../ui/clipboard";
import { cn } from "../ui/cn";
import { Markdown } from "../ui/Markdown";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";

interface DeployResult {
  moved: { id: string; columnId: string; position: number }[];
  archived: string[];
}

interface Props {
  tasks: BoardTask[];
  preselected: string[];
  templates: { header: string; footer: string };
  onClose: () => void;
  onDeployed: (result: DeployResult) => void;
}

export function ReleaseDialog({ tasks, preselected, templates, onClose, onDeployed }: Props) {
  const board = useBoard();
  const toast = useToast();
  const [step, setStep] = useState<"select" | "edit">("select");
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected));
  const [title, setTitle] = useState(`Release ${isoDate()} · ${board.project.name}`);
  const [content, setContent] = useState("");
  const [generated, setGenerated] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [copied, setCopied] = useState(false);
  const inProduction = board.columns.find((c) => c.role === "IN_PRODUCTION");
  const [destination, setDestination] = useState<"IN_PRODUCTION" | "ARCHIVE">(inProduction ? "IN_PRODUCTION" : "ARCHIVE");
  const [busy, setBusy] = useState(false);
  const selectedTasks = useMemo(() => tasks.filter((t) => chosen.has(t.id)), [tasks, chosen]);

  const generate = () => {
    const md = buildReleaseMarkdown({ header: templates.header, footer: templates.footer, title, tasks: selectedTasks });
    setContent(md);
    setGenerated(md);
    setTab("edit");
    setStep("edit");
  };

  const back = () => {
    if (content !== generated && !window.confirm("Se perderán los cambios que has hecho en el texto. ¿Continuar?")) return;
    setStep("select");
  };

  const copy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast("Copiado al portapapeles");
    } else toast("No se pudo copiar", "error");
  };

  const deploy = async () => {
    const target = destination === "IN_PRODUCTION" ? `a «${inProduction?.name}»` : "al archivo";
    if (!window.confirm(`Se guardará la release y ${selectedTasks.length} tarjeta(s) pasarán ${target}. ¿Continuar?`)) return;
    setBusy(true);
    const res = await board.track(
      deployRelease({ projectId: board.project.id, title, content, taskIds: selectedTasks.map((t) => t.id), destination }),
    );
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Release registrada como desplegada");
    onDeployed(res.data);
  };

  const now = new Date();

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <Rocket size={18} className="text-brand-600" /> Generar release
          <span className="text-xs font-normal text-slate-500">· Paso {step === "select" ? "1 de 2: tareas" : "2 de 2: revisar y exportar"}</span>
        </span>
      }
      footer={
        step === "select" ? (
          <>
            <span className="mr-auto text-xs text-slate-500">
              Cabecera y pie salen de <Link className="text-brand-600 hover:underline" href="/settings">tus plantillas</Link>.
            </span>
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={generate} disabled={selectedTasks.length === 0}>
              Generar con {selectedTasks.length} tarea(s)
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost mr-auto" onClick={back}><ArrowLeft size={15} /> Cambiar tareas</button>
            <button className="btn-secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} Copiar todo
            </button>
            <button className="btn-secondary" onClick={() => downloadText(content, releaseFileName(now, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary" onClick={() => downloadText(content, releaseFileName(now, "txt"), "text/plain")}>
              <FileText size={15} /> .txt
            </button>
            <button className="btn-primary" onClick={deploy} disabled={busy || !content.trim() || (destination === "IN_PRODUCTION" && !inProduction)}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Marcar como desplegado
            </button>
          </>
        )
      }
    >
      {step === "select" ? (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="rel-title">Título de la release</label>
            <input id="rel-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tareas incluidas</span>
            <div className="flex gap-1">
              <button className="btn-ghost py-1 text-xs" onClick={() => setChosen(new Set(tasks.map((t) => t.id)))}>Todas</button>
              <button className="btn-ghost py-1 text-xs" onClick={() => setChosen(new Set())}>Ninguna</button>
            </div>
          </div>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {tasks.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={chosen.has(t.id)}
                    onChange={() =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      })
                    }
                  />
                  <TypeBadge type={t.type} />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                </label>
              </li>
            ))}
            {tasks.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No hay tareas.</li>}
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium",
                  tab === t ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500",
                )}
              >
                {t === "edit" ? <><Pencil size={14} /> Editar</> : <><Eye size={14} /> Vista previa</>}
              </button>
            ))}
          </div>
          {tab === "edit" ? (
            <textarea
              className="input min-h-[45vh] flex-1 font-mono text-[13px] leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              aria-label="Contenido de la release"
              data-autofocus
            />
          ) : (
            <div className="min-h-[45vh] rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <Markdown>{content}</Markdown>
            </div>
          )}
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">Al marcar como desplegado</legend>
            <span className="text-xs font-medium text-slate-500">Al marcar como desplegado:</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "IN_PRODUCTION"} onChange={() => setDestination("IN_PRODUCTION")} disabled={!inProduction} />
              {inProduction ? `Mover a «${inProduction.name}»` : "Mover a En producción (no hay columna con ese rol)"}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "ARCHIVE"} onChange={() => setDestination("ARCHIVE")} />
              Archivar tarjetas
            </label>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
