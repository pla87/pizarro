"use client";

import { appTimeZone } from "@/lib/format";
import { ArrowLeft, Check, ClipboardCopy, Download, Eye, FileArchive, FileText, Loader2, Pencil, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { countReleasesOn, deployRelease, getReleaseTaskDetails } from "@/actions/releases";
import { buildReleaseMarkdown, computeReleaseCodes, defaultReleaseTitle, evergreenDue, isoDate, releaseFileName, releasesUntilDue, releaseZipName, swapTemplateBlock } from "@/lib/release";
import type { BoardTask, TemplateOption } from "@/lib/types";
import { useLocale, useT } from "@/i18n/client";
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
import { actionThrowResult } from "@/lib/stale-action";
import { mbNumber } from "@/lib/quota-message";
import { importWhenOnline, isNetworkError, loadWhenOnline, reportOffline } from "@/lib/connection";
import type { ReleaseEditorApi, ReleaseRichEditor as RichEditorComponent } from "./ReleaseRichEditor";

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
  const [content, setContent] = useState("");
  const [generated, setGenerated] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  // Con la preferencia «Con barra de formato» el paso 2 usa el mismo editor que las descripciones (sin Editar / Vista
  // previa). `content` es entonces el Markdown cargado en el editor; lo que la persona escribe se lee del editor al
  // usarlo (currentText). `richEmpty`: si lo ha dejado vacío (null mientras no lo toque).
  const rich = board.editorMode === "WYSIWYG";
  const [RichEditor, setRichEditor] = useState<typeof RichEditorComponent | null>(null);
  const richApi = useRef<ReleaseEditorApi>(null);
  const [richEmpty, setRichEmpty] = useState<boolean | null>(null);
  useEffect(() => {
    if (!rich) return;
    let alive = true;
    // Se pide al abrir el diálogo (en el paso 1): al generar ya suele estar. Mientras llega, el campo de texto normal.
    importWhenOnline(() => import("./ReleaseRichEditor")).then((m) => alive && setRichEditor(() => m.ReleaseRichEditor), () => {});
    return () => {
      alive = false;
    };
  }, [rich]);
  /** Markdown actual de la release (lo que se copia, se descarga y se guarda). */
  const currentText = () => (rich && richApi.current ? richApi.current.read() : content);
  /** Sustituye el texto entero (generar, cambiar cabecera o pie): el editor lo vuelve a cargar. */
  const loadText = (text: string) => {
    setContent(text);
    setRichEmpty(null);
  };
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
    <div className="grid gap-2 sm:grid-cols-2">
      {(["header", "footer"] as const).map((which) => {
        const own = which === "header" ? templates.headers : templates.footers;
        const proj = which === "header" ? projectTemplates.headers : projectTemplates.footers;
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
              {proj.length === 0 ? (
                own.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)
              ) : (
                <>
                  {own.length > 0 && <optgroup label={t("Tuyas")}>{own.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
                  <optgroup label={t("Del proyecto")}>{proj.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                </>
              )}
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

  const back = async () => {
    if (currentText() !== generated && !(await confirm({ title: t("Volver a la selección"), message: t("Se perderán los cambios que has hecho en el texto. ¿Continuar?"), confirmLabel: t("Continuar"), danger: true }))) return;
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
        a.download = releaseZipName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, part, total, uiLocale);
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
              {t("Cabecera y pie salen de")} <Link className="text-brand-600 dark:text-brand-300 hover:underline" href="/settings?tab=plantillas">{t("tus plantillas")}</Link>
              {projectTemplates.headers.length + projectTemplates.footers.length > 0 && <> {t("y de las")} <Link className="text-brand-600 dark:text-brand-300 hover:underline" href={`/p/${board.project.id}/settings?tab=releases`}>{t("plantillas del proyecto")}</Link></>}.
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
            <button className="btn-secondary" onClick={() => downloadText(currentText(), releaseFileName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary" onClick={() => downloadText(currentText(), releaseFileName({ day: isoDate(now, appTimeZone()), number: generatedNumber, project: board.project.name }, "txt"), "text/plain")}>
              <FileText size={15} /> .txt
            </button>
            {attachmentTotal > 0 && (
              <button className="btn-secondary" onClick={downloadAttachments} disabled={zipping}>
                {zipping ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />} {t("Descargar adjuntos ({n})", { n: attachmentTotal })}
              </button>
            )}
            <button className="btn-primary" onClick={deploy} disabled={busy || (richEmpty ?? !content.trim()) || (destination === "IN_PRODUCTION" && !inProduction)}>
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
              {/* Sin efecto posible (ya están todas o ninguna), el botón queda desactivado. */}
              <button className="btn-ghost py-1 text-xs" disabled={tasks.every((task) => chosen.has(task.id))} onClick={() => { selectionTouched.current = true; setChosen(new Set(tasks.map((t) => t.id))); }}>{t("Todas")}</button>
              <button className="btn-ghost py-1 text-xs" disabled={!tasks.some((task) => chosen.has(task.id))} onClick={() => { selectionTouched.current = true; setChosen(new Set()); }}>{t("Ninguna")}</button>
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
                    <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" title={t("Tarea fija en la release: se queda en su columna al desplegar")}>{t("fija")}{task.evergreenEvery === 2 ? ` · ${t("Cada dos")}` : task.evergreenEvery === 3 ? ` · ${t("Cada tres")}` : ""}{releaseNumber != null && task.evergreenEvery > 1 ? ` · ${dueHint(releasesUntilDue(releaseNumber, task.evergreenEvery))}` : ""}</span>
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
          {rich ? (
            RichEditor ? (
              <div data-release-editor="rich" className="flex min-h-0 flex-1 flex-col">
                <RichEditor value={content} label={t("Contenido de la release")} onEdited={setRichEmpty} apiRef={richApi} />
              </div>
            ) : (
              // Mientras llega el editor con barra (red lenta): el texto se puede ir editando aquí y el editor lo recoge.
              <textarea
                className="input min-h-[45vh] flex-1 font-mono text-[13px] leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                aria-label={t("Contenido de la release")}
                data-release-editor="provisional"
              />
            )
          ) : (
          <>
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
          </>
          )}
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
        </div>
      )}
    </Modal>
  );
}
