"use client";

import { ArrowLeft, Check, ClipboardCopy, Download, Eye, FileArchive, FileText, Loader2, Pencil, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { countReleasesOn, deployRelease, getReleaseTaskDetails } from "@/actions/releases";
import { partSuffix } from "@/lib/zip-plan";
import { buildReleaseMarkdown, computeReleaseCodes, defaultReleaseTitle, evergreenDue, isoDate, releaseFileName, swapTemplateBlock } from "@/lib/release";
import type { BoardTask, TemplateOption } from "@/lib/types";
import { useT } from "@/i18n/client";
import { copyText, downloadText } from "../ui/clipboard";
import { useConfirm } from "../ui/ConfirmDialog";
import { cn } from "../ui/cn";
import { Markdown } from "../ui/Markdown";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { TypeBadge } from "../ui/TypeBadge";
import { useBoard } from "./context";
import { MentionText } from "../ui/MentionText";
import { mentionsToPlain } from "@/lib/mentions";

interface DeployResult {
  moved: { id: string; columnId: string; position: number }[];
  archived: string[];
  /** Siguientes apariciones de tareas recurrentes que se acaban de terminar. */
  spawned?: BoardTask[];
}

interface Props {
  tasks: BoardTask[];
  preselected: string[];
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  onClose: () => void;
  onDeployed: (result: DeployResult) => void;
}

export function ReleaseDialog({ tasks, preselected, templates, onClose, onDeployed }: Props) {
  const board = useBoard();
  const now = useMemo(() => new Date(), []);
  const toast = useToast();
  const confirm = useConfirm();
  const t = useT();
  const [step, setStep] = useState<"select" | "edit">("select");
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected));
  /** Si la persona ya marcó o desmarcó alguna tarea, la cadencia de las fijas no vuelve a tocar la selección. */
  const selectionTouched = useRef(false);
  const [initialTasks] = useState(tasks);
  const [title, setTitle] = useState(() => defaultReleaseTitle(board.today, board.project.name));
  /** Si el usuario ya tocó el título, no se sustituye por el ordinal del día. */
  const titleEdited = useRef(false);
  const [content, setContent] = useState("");
  const [generated, setGenerated] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [copied, setCopied] = useState(false);
  const inProduction = board.columns.find((c) => c.role === "IN_PRODUCTION");
  const [destination, setDestination] = useState<"IN_PRODUCTION" | "ARCHIVE">(inProduction ? "IN_PRODUCTION" : "ARCHIVE");
  const [busy, setBusy] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [zipping, setZipping] = useState(false);
  /** Tareas con adjuntos de la release generada, con su código (para el ZIP). */
  const [zipItems, setZipItems] = useState<{ taskId: string; code: string; count: number }[]>([]);
  /** Número que tendrá la release (prefijo R32 de los códigos) y con cuál se generó el texto. */
  const [releaseNumber, setReleaseNumber] = useState<number | null>(null);
  const [generatedNumber, setGeneratedNumber] = useState<number | null>(null);
  const selectedTasks = useMemo(() => tasks.filter((t) => chosen.has(t.id)), [tasks, chosen]);
  const [headerId, setHeaderId] = useState(templates.headers[0]?.id ?? "");
  const [footerId, setFooterId] = useState(templates.footers[0]?.id ?? "");
  const templateText = (list: TemplateOption[], id: string) => list.find((t) => t.id === id)?.content ?? "";

  /** Cambia la cabecera o el pie; en el paso 2 se sustituye en el texto ya editado. */
  const chooseTemplate = (which: "header" | "footer", id: string) => {
    const list = which === "header" ? templates.headers : templates.footers;
    const prevId = which === "header" ? headerId : footerId;
    if (which === "header") setHeaderId(id);
    else setFooterId(id);
    if (step === "edit") {
      const swap = (text: string) => swapTemplateBlock(text, templateText(list, prevId), templateText(list, id), which === "header" ? "start" : "end");
      setContent(swap);
      setGenerated(swap);
    }
  };

  const templatePickers = (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["header", "footer"] as const).map((which) => {
        const list = which === "header" ? templates.headers : templates.footers;
        return (
          <div key={which}>
            <label className="label" htmlFor={`rel-${which}`}>{which === "header" ? t("Cabecera") : t("Pie")}</label>
            <select
              id={`rel-${which}`}
              className="input"
              value={which === "header" ? headerId : footerId}
              onChange={(e) => chooseTemplate(which, e.target.value)}
            >
              <option value="">{t("Ninguna")}</option>
              {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );

  // Varias releases el mismo día: el título por defecto lleva el ordinal «(2)», «(3)»…
  useEffect(() => {
    // Mismo día que usa el servidor (zona horaria de la app) para contar las releases.
    const day = board.today;
    countReleasesOn({ projectId: board.project.id, dayIso: day }).then((res) => {
      if (!res.ok) return;
      setReleaseNumber(res.data.nextNumber);
      // Tareas fijas con cadencia: solo vienen marcadas si a esta release le toca (se pueden marcar a mano).
      if (!selectionTouched.current) {
        const notDue = initialTasks.filter((x) => x.evergreen && !evergreenDue(res.data.nextNumber, x.evergreenEvery)).map((x) => x.id);
        if (notDue.length) setChosen((prev) => new Set([...prev].filter((id) => !notDue.includes(id))));
      }
      if (!titleEdited.current) setTitle(defaultReleaseTitle(day, board.project.name, res.data.today));
    });
  }, [board.project.id, board.project.name, board.today, initialTasks]);

  const generate = async () => {
    // Descripción y adjuntos no viajan con el tablero: se piden al generar.
    setLoadingDetails(true);
    const res = await getReleaseTaskDetails({ projectId: board.project.id, taskIds: selectedTasks.map((t) => t.id) });
    setLoadingDetails(false);
    if (!res.ok) return toast(res.error, "error");
    const details = new Map(res.data.map((d) => [d.id, d]));
    const releaseTasks = selectedTasks.map((t) => ({
      id: t.id,
      title: mentionsToPlain(t.title),
      kindId: t.kindId,
      linkUrl: t.linkUrl,
      description: details.get(t.id)?.description ?? "",
      attachments: details.get(t.id)?.attachments ?? [],
    }));
    const codes = computeReleaseCodes(board.kinds, releaseTasks, releaseNumber);
    setZipItems(
      releaseTasks.filter((t) => t.attachments.length).map((t) => ({ taskId: t.id, code: codes.get(t.id)!, count: t.attachments.length })),
    );
    const md = buildReleaseMarkdown({
      header: templateText(templates.headers, headerId),
      footer: templateText(templates.footers, footerId),
      kinds: board.kinds,
      tasks: releaseTasks,
      releaseNumber,
    });
    setContent(md);
    setGenerated(md);
    setGeneratedNumber(releaseNumber);
    setTab("edit");
    setStep("edit");
  };

  const back = async () => {
    if (content !== generated && !(await confirm({ title: t("Volver a la selección"), message: t("Se perderán los cambios que has hecho en el texto. ¿Continuar?"), confirmLabel: t("Continuar"), danger: true }))) return;
    setStep("select");
  };

  const copy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast(t("Copiado al portapapeles"));
    } else toast(t("No se pudo copiar"), "error");
  };

  const attachmentTotal = zipItems.reduce((n, i) => n + i.count, 0);

  const downloadAttachments = async () => {
    let changed: string | null = null;
    setZipping(true);
    try {
      const url = `/api/projects/${board.project.id}/release-attachments`;
      const body = JSON.stringify({ items: zipItems.map(({ taskId, code }) => ({ taskId, code })) });
      const post = (query: string) => fetch(`${url}${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      // Primero el plan (cuántos paquetes caben en el tope del proyecto) y luego cada paquete, uno tras otro.
      const planRes = await post("?plan=1");
      if (!planRes.ok) throw new Error(planRes.status === 429 ? await planRes.text() : "");
      const plan = (await planRes.json()) as { parts: { oversize: boolean }[]; maxMb: number; v?: string };
      const total = plan.parts.length;
      for (let part = 1; part <= total; part++) {
        // Con el token del plan: si los adjuntos cambian a mitad, el servidor responde 409 en vez de mezclar repartos.
        const res = await post(`?part=${part}${plan.v ? `&v=${plan.v}` : ""}`);
        if (res.status === 409) {
          changed = await res.text();
          throw new Error(changed);
        }
        if (!res.ok) throw new Error(res.status === 429 ? await res.text() : "");
        const href = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = href;
        a.download = `release-${isoDate(now)}-adjuntos${partSuffix(part, total)}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        // Pausa corta para que el navegador no agrupe ni descarte las descargas seguidas.
        if (part < total) await new Promise((r) => setTimeout(r, 400));
      }
      if (total > 1) toast(t("Adjuntos descargados en {n} paquetes de hasta {mb} MB", { n: total, mb: plan.maxMb }));
      if (plan.parts.some((p) => p.oversize)) toast(t("Algún archivo supera por sí solo los {mb} MB y va en su propio paquete.", { mb: plan.maxMb }), "error");
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t("No se pudieron descargar los adjuntos");
      // Adjuntos cambiados durante la descarga: se ofrece volver a empezar (nuevo plan y todos los paquetes).
      toast(message, "error", changed ? { label: t("Reintentar"), onClick: () => void downloadAttachments() } : undefined);
    } finally {
      setZipping(false);
    }
  };

  const deploy = async () => {
    const message = destination === "IN_PRODUCTION"
      ? t("Se guardará la release y {n} tarjeta(s) pasarán a «{name}». ¿Continuar?", { n: selectedTasks.length, name: inProduction?.name ?? "" })
      : t("Se guardará la release y {n} tarjeta(s) pasarán al archivo. ¿Continuar?", { n: selectedTasks.length });
    if (!(await confirm({ title: t("Desplegar la release"), message, confirmLabel: t("Continuar") }))) return;
    setBusy(true);
    const res = await board.track(
      deployRelease({
        projectId: board.project.id,
        title,
        content,
        taskIds: selectedTasks.map((t) => t.id),
        destination,
        attachments: zipItems.map(({ taskId, code }) => ({ taskId, code })),
        number: generatedNumber ?? undefined,
      }),
    ).catch(() => ({ ok: false as const, error: t("Error inesperado. Inténtalo de nuevo.") }));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Release registrada como desplegada"));
    onDeployed(res.data);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <Rocket size={18} className="text-brand-600 dark:text-brand-300" /> {t("Generar release")}
          <span className="text-xs font-normal text-slate-500">· {step === "select" ? t("Paso 1 de 2: tareas") : t("Paso 2 de 2: revisar y exportar")}</span>
        </span>
      }
      footer={
        step === "select" ? (
          <>
            <span className="mr-auto text-xs text-slate-500">
              {t("Cabecera y pie salen de")} <Link className="text-brand-600 dark:text-brand-300 hover:underline" href="/settings">{t("tus plantillas")}</Link>.
            </span>
            <button className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
            <button className="btn-primary" onClick={generate} disabled={selectedTasks.length === 0 || loadingDetails}>
              {loadingDetails && <Loader2 size={15} className="animate-spin" />} {t("Generar con {n} tarea(s)", { n: selectedTasks.length })}
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost mr-auto" onClick={back}><ArrowLeft size={15} /> {t("Cambiar tareas")}</button>
            <button className="btn-secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {t("Copiar todo")}
            </button>
            <button className="btn-secondary" onClick={() => downloadText(content, releaseFileName(now, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary" onClick={() => downloadText(content, releaseFileName(now, "txt"), "text/plain")}>
              <FileText size={15} /> .txt
            </button>
            {attachmentTotal > 0 && (
              <button className="btn-secondary" onClick={downloadAttachments} disabled={zipping}>
                {zipping ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />} {t("Descargar adjuntos ({n})", { n: attachmentTotal })}
              </button>
            )}
            <button className="btn-primary" onClick={deploy} disabled={busy || !content.trim() || (destination === "IN_PRODUCTION" && !inProduction)}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} {t("Marcar como desplegado")}
            </button>
          </>
        )
      }
    >
      {step === "select" ? (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="rel-title">{t("Título de la release")}</label>
            <input id="rel-title" className="input" value={title} onChange={(e) => {
                titleEdited.current = true;
                setTitle(e.target.value);
              }} maxLength={200} />
          </div>
          {templatePickers}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("Tareas incluidas")}</span>
            <div className="flex gap-1">
              <button className="btn-ghost py-1 text-xs" onClick={() => { selectionTouched.current = true; setChosen(new Set(tasks.map((t) => t.id))); }}>{t("Todas")}</button>
              <button className="btn-ghost py-1 text-xs" onClick={() => { selectionTouched.current = true; setChosen(new Set()); }}>{t("Ninguna")}</button>
            </div>
          </div>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {tasks.map((task) => (
              <li key={task.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={chosen.has(task.id)}
                    onChange={() => {
                      selectionTouched.current = true;
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(task.id)) next.delete(task.id);
                        else next.add(task.id);
                        return next;
                      });
                    }}
                  />
                  <TypeBadge kind={board.kindById.get(task.kindId)} />
                  <span className="min-w-0 flex-1 truncate text-sm"><MentionText text={task.title} /></span>
                  {task.evergreen && (
                    <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" title={t("Tarea fija en la release: se queda en su columna al desplegar")}>{t("fija")}{task.evergreenEvery === 2 ? ` · ${t("Cada dos")}` : task.evergreenEvery === 3 ? ` · ${t("Cada tres")}` : ""}</span>
                  )}
                </label>
              </li>
            ))}
            {tasks.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">{t("No hay tareas.")}</li>}
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3">
          {templatePickers}
          <div role="tablist" className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
            {(["edit", "preview"] as const).map((tb) => (
              <button
                key={tb}
                type="button"
                role="tab"
                id={`release-tab-${tb}`}
                aria-selected={tab === tb}
                aria-controls="release-tabpanel"
                onClick={() => setTab(tb)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium",
                  tab === tb ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500",
                )}
              >
                {tb === "edit" ? <><Pencil size={14} /> {t("Editar")}</> : <><Eye size={14} /> {t("Vista previa")}</>}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="release-tabpanel" aria-labelledby={`release-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === "edit" ? (
            <textarea
              className="input min-h-[45vh] flex-1 font-mono text-[13px] leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              aria-label={t("Contenido de la release")}
              data-autofocus
            />
          ) : (
            <div className="min-h-[45vh] rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <Markdown>{content}</Markdown>
            </div>
          )}
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">{t("Al marcar como desplegado")}</legend>
            <span className="text-xs font-medium text-slate-500">{t("Al marcar como desplegado:")}</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "IN_PRODUCTION"} onChange={() => setDestination("IN_PRODUCTION")} disabled={!inProduction} />
              {inProduction ? t("Mover a «{name}»", { name: inProduction.name }) : t("Mover a En producción (no hay columna con ese rol)")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "ARCHIVE"} onChange={() => setDestination("ARCHIVE")} />
              {t("Archivar tarjetas")}
            </label>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
