"use client";

import { ArrowLeft, Bot, Check, ClipboardCopy, Download, FileArchive, FileText, FolderInput, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAiPlanSetup, getAiPlanTaskDetails, saveAiPlan } from "@/actions/ai-plan";
import { moveTasks } from "@/actions/tasks";
import { useLocale, useT } from "@/i18n/client";
import { AI_PLAN_BUILTIN_ID, AI_PLAN_DEFAULTS, AI_PLAN_MAX_TASKS, aiPlanDownloadName, aiPlanFileName, buildAiPlanMarkdown, planAttachmentPaths, type AiPlanTask } from "@/lib/ai-plan";
import { isNetworkError, loadWhenOnline, reportOffline } from "@/lib/connection";
import { compareTaskOrder } from "@/lib/positions";
import { aiPlanZipName, evergreenDue, RELEASE_MAX_ATTACHMENT_TASKS, releasesUntilDue, swapTemplateBlock } from "@/lib/release";
import { actionThrowResult } from "@/lib/stale-action";
import { PRIORITY_LABEL } from "@/lib/task-fields";
import type { BoardColumn, BoardTask, TemplateOption } from "@/lib/types";
import { copyText, downloadText } from "../ui/clipboard";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { downloadAttachmentsZip } from "./attachments-zip";
import { useBoard } from "./context";
import { DraftTextEditor, TaskPickList, TemplatePickers, TemplateSourceNote, useDraftText } from "./DraftText";

type Groups = { headers: TemplateOption[]; footers: TemplateOption[] };
const NONE: Groups = { headers: [], footers: [] };

interface Setup {
  templates: Groups;
  projectTemplates: Groups;
  description: string;
  today: string;
  /** Versión del documento (_vN), por proyecto. */
  nextVersion: number;
  /** Número del plan en ESTA columna: el ritmo de sus tareas fijas (cada dos, cada tres) cuenta con él. */
  nextColumnPlan: number;
}

/** Tareas de la columna en el orden del tablero: primero las normales y después las fijas («Siempre en el plan»). */
function columnTasks(all: BoardTask[], columnId: string): BoardTask[] {
  const here = all.filter((x) => x.columnId === columnId).sort(compareTaskOrder);
  return [...here.filter((x) => !x.evergreen), ...here.filter((x) => x.evergreen)];
}

/**
 * «Generar plan de trabajo» de una columna con rol «Plan de trabajo para IA». Como «Generar release», en dos pasos:
 * 1) las tareas (todas por defecto, o las seleccionadas de la columna, más las fijas a las que les toca) y la cabecera y
 * el pie; 2) el texto en Markdown, editable con el editor de la preferencia de Mi perfil, para copiarlo, descargarlo
 * (.md, .txt) o guardarlo en la Documentación del proyecto («Plan de trabajo – AAAA-MM-DD_vN.md»). Al guardar se pueden
 * mover las tareas (no las fijas) a otra columna; por defecto no se mueve nada: generar un plan no termina las tareas.
 */
export function AiPlanDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const board = useBoard();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [tasks] = useState(() => columnTasks(board.getTasks(), column.id));
  const fixedIds = useMemo(() => tasks.filter((x) => x.evergreen).map((x) => x.id), [tasks]);
  const [chosen, setChosen] = useState<Set<string>>(() => {
    // Con tareas de la columna seleccionadas en el tablero, solo esas (y las fijas); si no, todas.
    const selected = board.getSelected();
    const picked = tasks.filter((x) => !x.evergreen && selected.has(x.id)).map((x) => x.id);
    return new Set(picked.length ? [...picked, ...fixedIds] : tasks.map((x) => x.id));
  });
  const selectionTouched = useRef(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const builtin = useMemo<Groups>(() => {
    const d = AI_PLAN_DEFAULTS[locale === "en" ? "en" : "es"];
    return { headers: [{ id: AI_PLAN_BUILTIN_ID, name: d.headerName, content: d.header }], footers: [{ id: AI_PLAN_BUILTIN_ID, name: d.footerName, content: d.footer }] };
  }, [locale]);
  const [headerId, setHeaderId] = useState(AI_PLAN_BUILTIN_ID);
  const [footerId, setFooterId] = useState(AI_PLAN_BUILTIN_ID);
  const templatesTouched = useRef(false);
  const [step, setStep] = useState<"select" | "edit">("select");
  const [generated, setGenerated] = useState("");
  const draft = useDraftText(board.editorMode);
  const { currentText, loadText, setTab } = draft;
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zipping, setZipping] = useState(false);
  /** Tareas con adjuntos del plan generado, con su carpeta en el ZIP (vacío si son demasiadas para ofrecerlo). */
  const [zipItems, setZipItems] = useState<{ taskId: string; folder: string; count: number }[]>([]);
  const [zipTooMany, setZipTooMany] = useState(false);
  const [busy, setBusy] = useState(false);
  const targets = useMemo(() => [...board.columns].sort((a, b) => a.position - b.position).filter((c) => c.id !== column.id), [board.columns, column.id]);
  const [moveOn, setMoveOn] = useState(false);
  const [moveTo, setMoveTo] = useState(() => targets[targets.findIndex((c) => c.position > column.position)]?.id ?? targets[0]?.id ?? "");

  useEffect(() => loadWhenOnline(() => getAiPlanSetup({ projectId: board.project.id, columnId: column.id }), (res) => {
    if (!res.ok) return toast(res.error, "error");
    setSetup(res.data);
    // Por defecto, la primera plantilla de la persona; si no tiene, la primera del proyecto; si tampoco, la de serie.
    if (!templatesTouched.current) {
      setHeaderId(res.data.templates.headers[0]?.id ?? res.data.projectTemplates.headers[0]?.id ?? AI_PLAN_BUILTIN_ID);
      setFooterId(res.data.templates.footers[0]?.id ?? res.data.projectTemplates.footers[0]?.id ?? AI_PLAN_BUILTIN_ID);
    }
    // Tareas fijas con cadencia: solo vienen marcadas si al plan que toca guardar en ESTA columna le toca (se pueden marcar a mano).
    if (!selectionTouched.current) {
      const notDue = tasks.filter((x) => x.evergreen && !evergreenDue(res.data.nextColumnPlan, x.evergreenEvery)).map((x) => x.id);
      if (notDue.length) setChosen((prev) => new Set([...prev].filter((id) => !notDue.includes(id))));
    }
  }, () => {}), [board.project.id, column.id, tasks, toast]);

  const own = setup?.templates ?? NONE;
  const project = setup?.projectTemplates ?? NONE;
  const all = (which: "header" | "footer") =>
    which === "header" ? [...own.headers, ...project.headers, ...builtin.headers] : [...own.footers, ...project.footers, ...builtin.footers];
  const templateText = (which: "header" | "footer", id: string) => all(which).find((x) => x.id === id)?.content ?? "";
  const chooseTemplate = (which: "header" | "footer", id: string) => {
    templatesTouched.current = true;
    const prevId = which === "header" ? headerId : footerId;
    if (which === "header") setHeaderId(id);
    else setFooterId(id);
    if (step === "edit") {
      const swap = (text: string) => swapTemplateBlock(text, templateText(which, prevId), templateText(which, id), which === "header" ? "start" : "end");
      loadText(swap(currentText()));
      setGenerated(swap);
    }
  };
  const pickers = <TemplatePickers own={own} project={project} builtin={builtin} headerId={headerId} footerId={footerId} onChange={chooseTemplate} idPrefix="plan" />;

  const selectedTasks = tasks.filter((x) => chosen.has(x.id));
  const tooMany = selectedTasks.length > AI_PLAN_MAX_TASKS;
  const today = setup?.today ?? board.today;
  const version = setup?.nextVersion ?? null;
  const columnPlan = setup?.nextColumnPlan ?? null;
  const docName = (ext: "md" | "txt" = "md") => aiPlanFileName(t("Plan de trabajo"), today, version ?? 1, ext);
  const dueHint = (n: number) => (n === 0 ? t("ahora") : n === 1 ? t("en el siguiente") : t("dentro de {n}", { n }));

  const generate = async () => {
    setLoading(true);
    const res = await getAiPlanTaskDetails({ projectId: board.project.id, taskIds: selectedTasks.map((x) => x.id) })
      .catch((e: unknown) => (isNetworkError(e) ? (reportOffline(), null) : actionThrowResult(e, t)));
    setLoading(false);
    if (!res) return;
    if (!res.ok) return toast(res.error, "error");
    const details = new Map(res.data.map((d) => [d.id, d]));
    const origin = window.location.origin;
    const labelName = new Map(board.labels.map((l) => [l.id, l.name]));
    const index = new Map(selectedTasks.map((x, i) => [x.id, i + 1]));
    const fields = board.project.taskFields;
    // Adjuntos: su ruta dentro del ZIP «adjuntos/NN-titulo/…» (el texto la cita; el servidor recalcula los mismos nombres).
    const paths = planAttachmentPaths(selectedTasks.map((x) => ({ id: x.id, title: x.title, attachments: details.get(x.id)?.attachments ?? [] })));
    const withFiles = selectedTasks.filter((x) => paths.byTask.has(x.id));
    // Como en la release, el ZIP admite 200 tareas con adjuntos; con más no se ofrece y el texto solo lleva los enlaces a Pizarro.
    const zipOk = withFiles.length <= RELEASE_MAX_ATTACHMENT_TASKS;
    setZipTooMany(!zipOk);
    setZipItems(zipOk ? withFiles.map((x) => ({ taskId: x.id, folder: paths.byTask.get(x.id)!.folder, count: paths.byTask.get(x.id)!.files.length })) : []);
    const planTasks: AiPlanTask[] = selectedTasks.map((x) => {
      const d = details.get(x.id);
      return {
        id: x.id,
        title: x.title,
        kind: board.kindById.get(x.kindId)?.name ?? null,
        url: `${origin}/p/${board.project.id}?task=${x.id}`,
        description: d?.description ?? "",
        subtasks: d?.subtasks ?? [],
        labels: x.labelIds.map((id) => labelName.get(id)).filter((n): n is string => !!n),
        dueDate: x.dueDate,
        startDate: fields.includes("startDate") ? x.startDate : null,
        priority: fields.includes("priority") && x.priority ? t(PRIORITY_LABEL[x.priority]) : null,
        linkUrl: x.linkUrl,
        links: d?.links ?? [],
        attachments: (d?.attachments ?? []).map((a) => ({ id: a.id, name: a.originalName, url: `${origin}/api/attachments/${a.id}`, path: zipOk ? paths.byAttachment.get(a.id) : undefined })),
        evergreen: x.evergreen,
        blockedBy: x.blockedBy ? { title: x.blockedBy.title, index: index.get(x.blockedBy.id) ?? null } : null,
      };
    });
    const md = buildAiPlanMarkdown({
      header: templateText("header", headerId),
      footer: templateText("footer", footerId),
      project: { name: board.project.name, description: setup?.description ?? "", url: `${origin}/p/${board.project.id}` },
      column: column.name,
      date: today,
      tasks: planTasks,
      origin,
    }, t);
    loadText(md);
    setGenerated(md);
    setTab("edit");
    setStep("edit");
  };

  /** ¿Ha cambiado la persona el texto del paso 2? (cambiar la cabecera o el pie no cuenta: también cambia `generated`). */
  const textEdited = () => step === "edit" && currentText() !== generated;
  const askingClose = useRef(false);
  /** Como en la release: con el texto cambiado se pregunta antes de descartarlo. `false` si no se cerró. */
  const requestClose = async (): Promise<boolean> => {
    if (!(await confirmDiscard())) return false;
    onClose();
    return true;
  };
  /** La pregunta de descartar el texto cambiado (cerrar o salir por un enlace): `true` si no hay nada que perder o se acepta. */
  const confirmDiscard = async (): Promise<boolean> => {
    if (askingClose.current) return false;
    if (!textEdited()) return true;
    askingClose.current = true;
    const ok = await confirm({
      title: t("Cambios sin guardar"),
      message: t("Has cambiado el texto del plan. ¿Cerrar y descartar los cambios?"),
      confirmLabel: t("Descartar cambios"),
      cancelLabel: t("Seguir editando"),
      danger: true,
    }).catch(() => false);
    askingClose.current = false;
    return ok;
  };

  const back = async () => {
    if (textEdited() && !(await confirm({ title: t("Volver a la selección"), message: t("Se perderán los cambios que has hecho en el texto. ¿Continuar?"), confirmLabel: t("Continuar"), danger: true }))) return;
    setStep("select");
  };

  const attachmentTotal = zipItems.reduce((n, i) => n + i.count, 0);
  const downloadAttachments = async () => {
    await downloadAttachmentsZip({
      setBusy: setZipping,
      projectId: board.project.id,
      items: zipItems.map(({ taskId, folder }) => ({ taskId, folder })),
      fileName: (part, total) => aiPlanZipName({ day: today, version, project: board.project.name }, part, total, locale === "en" ? "en" : "es"),
      t,
      toast,
    });
  };

  const copy = async () => {
    if (await copyText(currentText())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast(t("Copiado al portapapeles"));
    } else toast(t("No se pudo copiar"), "error");
  };

  /** Tareas del plan que se moverían al guardar (las fijas se quedan siempre en su columna). */
  const movable = selectedTasks.filter((x) => !x.evergreen && board.getTask(x.id)?.columnId === column.id).map((x) => x.id);
  const target = targets.find((c) => c.id === moveTo);

  const save = async () => {
    const moving = moveOn && target && movable.length > 0;
    if (moving && !(await board.confirmLeaveReview(movable, target.id))) return;
    setBusy(true);
    const res = await board.track(saveAiPlan({ projectId: board.project.id, columnId: column.id, content: currentText() })).catch((e) => actionThrowResult(e, t));
    if (!res.ok) {
      setBusy(false);
      return toast(res.error, "error");
    }
    const openDocs = { label: t("Abrir Documentación"), onClick: () => router.push(`/p/${board.project.id}/docs?doc=${res.data.id}`) };
    if (moving) {
      const moved = await board.track(moveTasks(movable, target.id)).catch((e) => actionThrowResult(e, t));
      if (!moved.ok) toast(t("El plan se ha guardado, pero no se han podido mover las tareas: {reason}", { reason: moved.error }), "error");
      else {
        const now = new Date().toISOString();
        for (const m of moved.data.moved) board.patchTask(m.id, { columnId: target.id, position: m.position, evergreen: false, evergreenEvery: 1, columnEnteredAt: now });
        moved.data.spawned.forEach(board.upsertTask);
      }
    }
    setBusy(false);
    toast(t("Guardado en Documentación como «{name}».", { name: res.data.name }), "success", openDocs);
    onClose();
  };

  return (
    <Modal
      open
      onClose={requestClose}
      size="xl"
      title={
        // En móvil el paso se recorta con «…»; el icono y el nombre no se encogen (antes el icono desaparecía).
        <span className="flex min-w-0 items-center gap-2">
          <Bot size={18} className="shrink-0 text-brand-600 dark:text-brand-300" /> <span className="shrink-0">{t("Generar plan de trabajo")}</span>
          <span className="min-w-0 truncate text-xs font-normal text-slate-500">· {step === "select" ? t("Paso 1 de 2: tareas") : t("Paso 2 de 2: revisar y exportar")}</span>
        </span>
      }
      footer={
        step === "select" ? (
          <>
            {tooMany ? (
              <span className="mr-auto text-xs text-red-600 dark:text-red-400" role="alert">{t("Un plan de trabajo admite como mucho 500 tareas: quita alguna de la selección.")}</span>
            ) : (
              <TemplateSourceNote projectId={board.project.id} projectTab="releases" withProject />
            )}
            <button className="btn-secondary" onClick={() => void requestClose()}>{t("Cancelar")}</button>
            <button className="btn-primary" onClick={generate} disabled={selectedTasks.length === 0 || tooMany || loading}>
              {loading && <Loader2 size={15} className="animate-spin" />} {t("Generar con {n} tarea(s)", { n: selectedTasks.length })}
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost mr-auto" onClick={back}><ArrowLeft size={15} /> {t("Cambiar tareas")}</button>
            <button className="btn-secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {t("Copiar todo")}
            </button>
            <button className="btn-secondary" onClick={() => downloadText(currentText(), aiPlanDownloadName(docName("md")), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary" onClick={() => downloadText(currentText(), aiPlanDownloadName(docName("txt")), "text/plain")}>
              <FileText size={15} /> .txt
            </button>
            {attachmentTotal > 0 && (
              <button className="btn-secondary" onClick={downloadAttachments} disabled={zipping} title={t("ZIP «adjuntos/…» con los adjuntos de las tareas del plan: el texto cita sus rutas")}>
                {zipping ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />} {t("Descargar adjuntos ({n})", { n: attachmentTotal })}
              </button>
            )}
            <button className="btn-primary" onClick={save} disabled={busy || draft.empty()} title={t("Guardar en Documentación como «{name}»", { name: docName() })}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <FolderInput size={15} />} {t("Guardar en Documentación")}
            </button>
          </>
        )
      }
    >
      {step === "select" ? (
        <div className="space-y-3" data-plan-step="select">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t("Un texto en Markdown para que una IA (p. ej. Claude Code) haga estas tareas: contexto del proyecto, instrucciones y, por cada tarea, su descripción, subtareas, etiquetas, fechas, enlaces y adjuntos.")}
          </p>
          {pickers}
          <TaskPickList
            tasks={tasks}
            chosen={chosen}
            setChosen={setChosen}
            onTouch={() => { selectionTouched.current = true; }}
            badge={(task) => task.evergreen && (
              <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" title={t("Siempre en el plan: entra en cada plan y no se mueve al guardar")}>
                {t("fija")}{task.evergreenEvery === 2 ? ` · ${t("Cada dos")}` : task.evergreenEvery === 3 ? ` · ${t("Cada tres")}` : ""}{columnPlan != null && task.evergreenEvery > 1 ? ` · ${dueHint(releasesUntilDue(columnPlan, task.evergreenEvery))}` : ""}
              </span>
            )}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3" data-plan-step="edit">
          {pickers}
          <TemplateSourceNote projectId={board.project.id} projectTab="releases" withProject confirmLeave={() => (textEdited() ? confirmDiscard() : false)} />
          <DraftTextEditor draft={draft} label={t("Texto del plan de trabajo")} idPrefix="plan" dataAttr="data-plan-editor" onEscape={() => void requestClose()} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={moveOn} onChange={(e) => setMoveOn(e.target.checked)} disabled={targets.length === 0 || movable.length === 0} />
              {t("Al guardar, mover las tareas a")}
            </label>
            <select className="input w-auto py-1" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} disabled={!moveOn} aria-label={t("Columna a la que se mueven las tareas")}>
              {targets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="text-xs text-slate-500">{t("Las fijas se quedan en la columna.")}</span>
          </div>
          {zipTooMany && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{t("Un plan admite como mucho 200 tareas con adjuntos en el ZIP: el texto solo lleva los enlaces a Pizarro.")}</p>}
          <p className="text-xs text-slate-500">
            {t("Se guardará como «{name}».", { name: docName() })}
            {attachmentTotal > 0 && <> {t("Los adjuntos no se guardan con el plan: van en el ZIP de «Descargar adjuntos» y el texto cita su ruta y su enlace a Pizarro.")}</>}
          </p>
        </div>
      )}
    </Modal>
  );
}
