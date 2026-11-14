"use client";

import { appTimeZone } from "@/lib/format";
import { ArrowLeft, Check, ClipboardCopy, Download, FileArchive, FileText, Loader2, Rocket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { countReleasesOn, deployRelease, getReleaseTaskDetails } from "@/actions/releases";
import { buildReleaseMarkdown, computeReleaseCodes, defaultReleaseTitle, evergreenDue, isoDate, RELEASE_MAX_ATTACHMENT_TASKS, RELEASE_MAX_TASKS, releaseFileName, releasesUntilDue, releaseZipName, swapTemplateBlock } from "@/lib/release";
import type { BoardTask, TemplateOption } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
import { copyText, downloadText } from "../ui/clipboard";
import { useConfirm } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";
import { mentionsToPlain } from "@/lib/mentions";
import { actionThrowResult } from "@/lib/stale-action";
import { mbNumber } from "@/lib/quota-message";
import { isNetworkError, loadWhenOnline, reportOffline } from "@/lib/connection";
import { downloadAttachmentsZip } from "./attachments-zip";
import { DraftTextEditor, TaskPickList, TemplatePickers, TemplateSourceNote, useDraftText } from "./DraftText";

interface DeployResult {
  moved: { id: string; columnId: string; position: number }[];
  archived: string[];
  /** Siguientes apariciones de tareas recurrentes que se acaban de terminar. */
  spawned?: BoardTask[];
  /** Con las copias de adjuntos de la release el proyecto supera su cuota de almacenamiento. */
  storageWarning?: { usedMb: number; limitMb: number } | null;
}

interface Props {
  tasks: BoardTask[];
  preselected: string[];
  templates: { headers: TemplateOption[]; footers: TemplateOption[] };
  /** Los del proyecto: van después de los del usuario y no cuentan para la selección por defecto. */
  projectTemplates: { headers: TemplateOption[]; footers: TemplateOption[] };
  onClose: () => void;
  onDeployed: (result: DeployResult) => void;
}

export function ReleaseDialog({ tasks, preselected, templates, projectTemplates, onClose, onDeployed }: Props) {
  const board = useBoard();
  const now = useMemo(() => new Date(), []);
  const toast = useToast();
  const confirm = useConfirm();
  const t = useT();
  const uiLocale = useLocale();
  const [step, setStep] = useState<"select" | "edit">("select");
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected));
  /** Si la persona ya marcó o desmarcó alguna tarea, la cadencia de las fijas no vuelve a tocar la selección. */
  const selectionTouched = useRef(false);
  const [initialTasks] = useState(tasks);
  const [title, setTitle] = useState(() => defaultReleaseTitle(board.today, board.project.name));
  /** Si el usuario ya tocó el título, no se sustituye por el ordinal del día. */
  const titleEdited = useRef(false);
  const [generated, setGenerated] = useState("");
  // Texto del paso 2, con el editor de la preferencia de Mi perfil (barra de formato o Markdown): ver DraftText.tsx.
  const draft = useDraftText(board.editorMode);
  const { currentText, loadText, setTab } = draft;
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
  /** Cuándo le toca a una tarea fija respecto a la release que se genera: «ahora», «en la siguiente», «dentro de 2»… */
  const dueHint = (n: number) => (n === 0 ? t("ahora") : n === 1 ? t("en la siguiente") : t("dentro de {n}", { n }));
  const [generatedNumber, setGeneratedNumber] = useState<number | null>(null);
  /**
   * Tareas del texto generado con la columna en la que estaban y su título: se despliegan esas (no la selección viva, de
   * la que desaparece una tarea que otra persona archiva o borra) y el servidor rechaza el despliegue si alguna ha
   * cambiado de columna o de título entretanto.
   */
  const [generatedTasks, setGeneratedTasks] = useState<{ taskId: string; columnId: string; title: string }[]>([]);
  const selectedTasks = useMemo(() => tasks.filter((t) => chosen.has(t.id)), [tasks, chosen]);
  // Topes de la release (los mismos que el servidor): con más, «Generar» o «Marcar como desplegado» se desactivan con su
  // motivo (antes llegaba el error de zod en inglés).
  const tooMany = selectedTasks.length > RELEASE_MAX_TASKS;
  const [headerId, setHeaderId] = useState(templates.headers[0]?.id ?? "");
  const [footerId, setFooterId] = useState(templates.footers[0]?.id ?? "");
  /** Del usuario primero y luego los del proyecto: así se buscan por id. */
  const allTemplates = (which: "header" | "footer") =>
    which === "header" ? [...templates.headers, ...projectTemplates.headers] : [...templates.footers, ...projectTemplates.footers];
  const templateText = (list: TemplateOption[], id: string) => list.find((t) => t.id === id)?.content ?? "";

  /** Cambia la cabecera o el pie; en el paso 2 se sustituye en el texto ya editado. */
  const chooseTemplate = (which: "header" | "footer", id: string) => {
    const list = allTemplates(which);
    const prevId = which === "header" ? headerId : footerId;
    if (which === "header") setHeaderId(id);
    else setFooterId(id);
    if (step === "edit") {
      const swap = (text: string) => swapTemplateBlock(text, templateText(list, prevId), templateText(list, id), which === "header" ? "start" : "end");
      loadText(swap(currentText()));
      setGenerated(swap);
    }
  };

  const templatePickers = (
    <TemplatePickers own={templates} project={projectTemplates} headerId={headerId} footerId={footerId} onChange={chooseTemplate} idPrefix="rel" />
  );

  // Varias releases el mismo día: el título por defecto lleva el ordinal «(2)», «(3)»…
  useEffect(() => {
    // Mismo día que usa el servidor (zona horaria de la app) para contar las releases.
    const day = board.today;
    // Sin red se pide al volver la conexión (antes el fallo quedaba sin atender y el título no llevaba el ordinal).
    return loadWhenOnline(() => countReleasesOn({ projectId: board.project.id, dayIso: day }), (res) => {
      if (!res.ok) return;
      setReleaseNumber(res.data.nextNumber);
      // Tareas fijas con cadencia: solo vienen marcadas si a esta release le toca (se pueden marcar a mano).
      if (!selectionTouched.current) {
        const notDue = initialTasks.filter((x) => x.evergreen && !evergreenDue(res.data.nextNumber, x.evergreenEvery)).map((x) => x.id);
        if (notDue.length) setChosen((prev) => new Set([...prev].filter((id) => !notDue.includes(id))));
      }
      if (!titleEdited.current) setTitle(defaultReleaseTitle(day, board.project.name, res.data.today));
    }, () => {});
  }, [board.project.id, board.project.name, board.today, initialTasks]);

  const generate = async () => {
    // Descripción y adjuntos no viajan con el tablero: se piden al generar.
    setLoadingDetails(true);
    const res = await getReleaseTaskDetails({ projectId: board.project.id, taskIds: selectedTasks.map((t) => t.id) }).catch((e: unknown) => (isNetworkError(e) ? (reportOffline(), null) : actionThrowResult(e, t)));
    setLoadingDetails(false);
    // Sin red: el aviso fijo de «Sin conexión» lo explica; «Generar» sigue disponible para volver a probar.
    if (!res) return;
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
    setGeneratedTasks(selectedTasks.map((x) => ({ taskId: x.id, columnId: x.columnId, title: x.title })));
    const codes = computeReleaseCodes(board.kinds, releaseTasks, releaseNumber);
    setZipItems(
      releaseTasks.filter((t) => t.attachments.length).map((t) => ({ taskId: t.id, code: codes.get(t.id)!, count: t.attachments.length })),
    );
    const md = buildReleaseMarkdown({
      header: templateText(allTemplates("header"), headerId),
      footer: templateText(allTemplates("footer"), footerId),
      kinds: board.kinds,
      tasks: releaseTasks,
      releaseNumber,
    }, t);
    loadText(md);
    setGenerated(md);
    setGeneratedNumber(releaseNumber);
    setTab("edit");
    setStep("edit");
  };

  /** ¿Ha cambiado la persona el texto del paso 2? (cambiar la cabecera o el pie no cuenta: también cambia `generated`). */
  const textEdited = () => step === "edit" && currentText() !== generated;
  // Una sola pregunta a la vez (Escape o clics repetidos no las apilan).
  const askingClose = useRef(false);
  /**
   * Cerrar con Escape, «Cancelar», la X, clic fuera o atrás: con el texto del paso 2 cambiado se pregunta antes de
   * descartarlo (como el detalle de una tarea con cambios sin guardar); sin cambios se cierra directamente. `false` si no
   * se cerró (el botón atrás del móvil vuelve entonces a poder cerrarlo).
   */
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
      message: t("Has cambiado el texto de la release. ¿Cerrar y descartar los cambios?"),
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

  const copy = async () => {
    if (await copyText(currentText())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast(t("Copiado al portapapeles"));
    } else toast(t("No se pudo copiar"), "error");
  };

  const attachmentTotal = zipItems.reduce((n, i) => n + i.count, 0);
  const tooManyAttachments = zipItems.length > RELEASE_MAX_ATTACHMENT_TASKS;

  const downloadAttachments = async () => {
    setZipping(true);
    await downloadAttachmentsZip({
      projectId: board.project.id,
      items: zipItems.map(({ taskId, code }) => ({ taskId, code })),
      fileName: (part, total) => releaseZipName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, part, total, uiLocale),
      t,
      toast,
    });
    setZipping(false);
  };

  const deploy = async () => {
    const message = destination === "IN_PRODUCTION"
      ? t("Se guardará la release y {n} tarjeta(s) pasarán a «{name}». ¿Continuar?", { n: generatedTasks.length, name: inProduction?.name ?? "" })
      : t("Se guardará la release y {n} tarjeta(s) pasarán al archivo. ¿Continuar?", { n: generatedTasks.length });
    if (!(await confirm({ title: t("Desplegar la release"), message, confirmLabel: t("Continuar") }))) return;
    setBusy(true);
    const res = await board.track(
      deployRelease({
        projectId: board.project.id,
        title,
        content: currentText(),
        taskIds: generatedTasks.map((x) => x.taskId),
        columns: generatedTasks.map(({ taskId, columnId }) => ({ taskId, columnId })),
        titles: generatedTasks.map(({ taskId, title }) => ({ taskId, title })),
        destination,
        attachments: zipItems.map(({ taskId, code }) => ({ taskId, code })),
        number: generatedNumber ?? undefined,
      }),
    ).catch((e) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Release registrada como desplegada"));
    if (res.data.storageWarning) {
      toast(t("Con los adjuntos de esta release el proyecto supera su cuota de almacenamiento ({used} de {limit} MB). Libera espacio, por ejemplo borrando adjuntos de releases antiguas: {link}", { used: mbNumber(res.data.storageWarning.usedMb, uiLocale), limit: mbNumber(res.data.storageWarning.limitMb, uiLocale), link: `/p/${board.project.id}/settings?tab=adjuntos` }), "error");
    }
    onDeployed(res.data);
  };

  return (
    <Modal
      open
      onClose={requestClose}
      size="xl"
      title={
        // En móvil el paso se recorta con «…»; el icono y el nombre no se encogen (antes el icono desaparecía).
        <span className="flex min-w-0 items-center gap-2">
          <Rocket size={18} className="shrink-0 text-brand-600 dark:text-brand-300" /> <span className="shrink-0">{t("Generar release")}</span>
          <span className="min-w-0 truncate text-xs font-normal text-slate-500">· {step === "select" ? t("Paso 1 de 2: tareas") : t("Paso 2 de 2: revisar y exportar")}</span>
        </span>
      }
      footer={
        step === "select" ? (
          <>
            {tooMany ? (
              <span className="mr-auto text-xs text-red-600 dark:text-red-400" role="alert">{t("Una release admite como mucho 500 tareas: quita alguna de la selección.")}</span>
            ) : (
              <TemplateSourceNote projectId={board.project.id} projectTab="releases" withProject={projectTemplates.headers.length + projectTemplates.footers.length > 0} />
            )}
            <button className="btn-secondary" onClick={() => void requestClose()}>{t("Cancelar")}</button>
            <button className="btn-primary" onClick={generate} disabled={selectedTasks.length === 0 || tooMany || loadingDetails}>
              {loadingDetails && <Loader2 size={15} className="animate-spin" />} {t("Generar con {n} tarea(s)", { n: selectedTasks.length })}
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost mr-auto" onClick={back}><ArrowLeft size={15} /> {t("Cambiar tareas")}</button>
            <button className="btn-secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {t("Copiar todo")}
            </button>
            <button className="btn-secondary" onClick={() => downloadText(currentText(), releaseFileName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary" onClick={() => downloadText(currentText(), releaseFileName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, "txt"), "text/plain")}>
              <FileText size={15} /> .txt
            </button>
            {attachmentTotal > 0 && (
              <button className="btn-secondary" onClick={downloadAttachments} disabled={zipping || tooManyAttachments}>
                {zipping ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />} {t("Descargar adjuntos ({n})", { n: attachmentTotal })}
              </button>
            )}
            <button className="btn-primary" onClick={deploy} disabled={busy || draft.empty() || tooManyAttachments || (destination === "IN_PRODUCTION" && !inProduction)}>
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
          <TaskPickList
            tasks={tasks}
            chosen={chosen}
            setChosen={setChosen}
            onTouch={() => { selectionTouched.current = true; }}
            badge={(task) => task.evergreen && (
              <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" title={t("Tarea fija en la release: se queda en su columna al desplegar")}>{t("fija")}{task.evergreenEvery === 2 ? ` · ${t("Cada dos")}` : task.evergreenEvery === 3 ? ` · ${t("Cada tres")}` : ""}{releaseNumber != null && task.evergreenEvery > 1 ? ` · ${dueHint(releasesUntilDue(releaseNumber, task.evergreenEvery))}` : ""}</span>
            )}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3">
          {templatePickers}
          <TemplateSourceNote projectId={board.project.id} projectTab="releases" withProject={projectTemplates.headers.length + projectTemplates.footers.length > 0} confirmLeave={() => (textEdited() ? confirmDiscard() : false)} />
          <DraftTextEditor draft={draft} label={t("Contenido de la release")} idPrefix="release" dataAttr="data-release-editor" onEscape={() => void requestClose()} />
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">{t("Al marcar como desplegado")}</legend>
            {/* El rótulo visible repite el del grupo (legend): oculto para el lector de pantalla, que ya lo anuncia. */}
            <span className="text-xs font-medium text-slate-500" aria-hidden>{t("Al marcar como desplegado:")}</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "IN_PRODUCTION"} onChange={() => setDestination("IN_PRODUCTION")} disabled={!inProduction} />
              {inProduction ? t("Mover a «{name}»", { name: inProduction.name }) : t("Mover a En producción (no hay columna con ese rol)")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "ARCHIVE"} onChange={() => setDestination("ARCHIVE")} />
              {t("Archivar tarjetas")}
            </label>
          </fieldset>
          {tooManyAttachments && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">{t("Una release admite como mucho 200 tareas con adjuntos: quita alguna de la selección.")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
