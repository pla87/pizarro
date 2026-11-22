"use client";

import { appTimeZone } from "@/lib/format";
import { ChevronDown, ClipboardCopy, Download, FileArchive, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { deleteRelease, deleteReleaseAttachments, getReleaseContent } from "@/actions/releases";
import { copyText, downloadText } from "@/components/ui/clipboard";
import { startDownload } from "@/components/board/attachments-zip";
import { cn } from "@/components/ui/cn";
import { Highlight } from "@/components/ui/Highlight";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LazyMarkdown } from "@/components/ui/LazyMarkdown";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { blankEmptyParagraphs } from "@/lib/markdown-entities";
import { isoDate, releaseFileName, releaseZipName } from "@/lib/release";
import { ProjectsContext } from "@/components/ProjectMenu";
import { useIntlLocale, useLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import { useSafeRefresh } from "@/components/useSafeRefresh";
import { loadWhenOnline } from "@/lib/connection";
import { actionThrowMessage, actionThrowResult } from "@/lib/stale-action";

interface Props {
  release: { id: string; number: number; title: string; deployedAt: string; author: string | null; taskCount: number; attachments: string[] };
  /** Lo buscado en la página (?q=): se resalta en el título, la línea de datos, los adjuntos y el texto. */
  query?: string;
  /** Con búsqueda, se abre sola (es una coincidencia; ReleasesList la pide para las primeras). */
  autoOpen?: boolean;
}

export function ReleaseEntry({ release, query = "", autoOpen = false }: Props) {
  const t = useT();
  const uiLocale = useLocale();
  const locale = useIntlLocale();
  // Abierta o cerrada sin búsqueda (lo que eligió quien la mira) y, aparte, con cada búsqueda: con una, las coincidencias
  // salen abiertas (`autoOpen`) salvo que se cierren a mano; al vaciarla vuelve a como estaba antes de buscar.
  const [manualOpen, setManualOpen] = useState(false);
  const [searchToggle, setSearchToggle] = useState<{ query: string; open: boolean } | null>(null);
  const open = query ? (searchToggle?.query === query ? searchToggle.open : autoOpen) : manualOpen;
  const toggle = () => (query ? setSearchToggle({ query, open: !open }) : setManualOpen(!open));
  const toast = useToast();
  const confirm = useConfirm();
  const safeRefresh = useSafeRefresh();
  // Nombre del proyecto para el ZIP (el mismo que da el diálogo de generar la release).
  const { projects, currentId } = useContext(ProjectsContext);
  const projectName = projects.find((p) => p.id === currentId)?.name ?? null;
  // El texto llega al desplegarla (la página solo trae la cabecera de cada release) y se guarda: una release desplegada
  // no cambia. Sin red se pide al volver la conexión.
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = content !== null;
  useEffect(() => {
    if (!open || loaded) return;
    return loadWhenOnline(
      () => getReleaseContent(release.id),
      (res) => {
        setLoadError(res.ok ? null : res.error);
        if (res.ok) setContent(res.data.content);
      },
      (err) => setLoadError(actionThrowMessage(err, t)),
    );
  }, [open, loaded, release.id, t]);
  // Lo que se copia y se descarga: las releases guardadas con el editor con barra en versiones anteriores pueden traer párrafos
  // vacíos como «&nbsp;» (salen como una línea en blanco; el resto, idéntico).
  const text = content === null ? null : blankEmptyParagraphs(content);
  // El texto pintado (con lo buscado resaltado) no se vuelve a interpretar al cambiar otro estado de la entrada (el
  // botón de descargar, los paquetes del ZIP): con una release de cientos de tareas y muchas coincidencias se notaría.
  const body = useMemo(() => (content === null ? null : <LazyMarkdown highlight={query}>{content}</LazyMarkdown>), [content, query]);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState(release.attachments);
  // Las copias de los adjuntos se guardan unos segundos después del despliegue: al refrescar la página
  // (el refresco de la página) llegan más y se muestran sin tener que volver a montar la entrada.
  const [seen, setSeen] = useState(release.attachments.join("\n"));
  if (release.attachments.join("\n") !== seen) {
    setSeen(release.attachments.join("\n"));
    setAttachments(release.attachments);
  }
  const [removed, setRemoved] = useState(false);
  const date = new Date(release.deployedAt);
  // Los adjuntos pueden salir en varios paquetes ZIP (tope del proyecto): se consulta el plan al abrir la release.
  const [parts, setParts] = useState(1);
  /** Token de versión del plan: cada paquete lo devuelve para detectar que los adjuntos han cambiado. */
  const [planToken, setPlanToken] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const attachmentCount = attachments.length;
  const fetchPlan = useCallback(async (): Promise<{ parts: number; v: string | null; busy: boolean } | null> => {
    try {
      const r = await fetch(`/api/releases/${release.id}/attachments?plan=1`);
      if (!r.ok) return null;
      const plan = (await r.json()) as { parts: unknown[]; v?: string; busy?: boolean };
      return plan.parts.length > 0 ? { parts: plan.parts.length, v: plan.v ?? null, busy: !!plan.busy } : null;
    } catch {
      return null;
    }
  }, [release.id]);
  useEffect(() => {
    if (!open || !attachmentCount) return;
    let cancelled = false;
    void fetchPlan().then((plan) => {
      if (cancelled || !plan) return;
      setParts(plan.parts);
      setPlanToken(plan.v);
    });
    return () => {
      cancelled = true;
    };
  }, [open, attachmentCount, fetchPlan]);

  /**
   * Descarga un paquete: la hace el propio navegador (con su progreso y su botón de cancelar, sin pasar por la memoria de
   * la página). Antes se pide el plan al momento: si los adjuntos han cambiado desde que se abrió la release (otro token)
   * se avisa y se ofrece volver a empezar, como hacía el 409; si ya hay otro ZIP en curso, se avisa sin lanzarla. El
   * enlace lleva el token (`?v=`): si aun así cambian entre medias, el servidor responde 409 y el navegador muestra la
   * descarga como fallida.
   */
  const downloadPart = async (part: number, expected: string | null = planToken) => {
    setDownloading(true);
    try {
      const fresh = await fetchPlan();
      if (!fresh) return toast(t("No se pudieron descargar los adjuntos"), "error");
      setParts(fresh.parts);
      setPlanToken(fresh.v);
      if (expected && fresh.v !== expected) {
        // Vuelve a empezar: el plan nuevo y el mismo paquete (si sigue existiendo).
        toast(t("Los adjuntos han cambiado mientras se descargaban. Vuelve a descargarlos."), "error", { label: t("Reintentar"), onClick: () => void downloadPart(Math.min(part, fresh.parts), fresh.v) });
        return;
      }
      if (fresh.busy) return toast(t("Ya se está preparando otro ZIP. Inténtalo de nuevo en unos segundos."), "error");
      const name = releaseZipName({ day: isoDate(date, appTimeZone()), number: release.number, project: projectName }, part, fresh.parts, uiLocale);
      startDownload(`/api/releases/${release.id}/attachments?part=${part}${fresh.v ? `&v=${fresh.v}` : ""}`, name);
      // El botón vuelve enseguida: la descarga sigue en el navegador.
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      toast(t("No se pudieron descargar los adjuntos"), "error");
    } finally {
      setDownloading(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: t("Borrar release"), message: t("¿Borrar la release «{title}» del histórico? Se borran también sus adjuntos. No se puede deshacer. Las tareas no cambian: conservan su código R{number} y la siguiente release no reutilizará ese número.", { title: release.title, number: release.number }), confirmLabel: t("Borrar"), danger: true }))) return;
    setBusy(true);
    // Sin red la acción lanza: sin el catch el botón se quedaba ocupado para siempre y sin aviso.
    const res = await deleteRelease(release.id).catch((e) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setRemoved(true);
    toast(t("Release borrada"));
    safeRefresh();
  };

  const removeAttachments = async () => {
    if (!(await confirm({ title: t("Borrar adjuntos"), message: attachments.length === 1 ? t("¿Borrar el adjunto de esta release? El texto se conserva.") : t("¿Borrar los {n} adjuntos de esta release? El texto se conserva.", { n: attachments.length }), confirmLabel: t("Borrar"), danger: true }))) return;
    setBusy(true);
    const res = await deleteReleaseAttachments(release.id).catch((e) => actionThrowResult(e, t));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    setAttachments([]);
    toast(t("Adjuntos borrados"));
    safeRefresh();
  };

  if (removed) return null;
  return (
    <article className="card">
      {/* El título es un <h2> con el botón dentro (un botón no puede contener un título). El botón cubre toda la cabecera
          con su ::after, así que se abre pulsando en cualquier parte de ella, como antes. */}
      <div className="relative flex w-full items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            <button type="button" className="block w-full truncate text-left after:absolute after:inset-0" onClick={toggle} aria-expanded={open}>
              {/* El espacio va delante del título, en el mismo texto: separa el número en el nombre accesible del botón
                  («R3 Release…», no «R3Release…»). Con lo buscado al principio del título queda solo, seguido de la
                  <mark>, y Chrome lo cuenta (accesibilidad-releases-e2e.mjs, PART=resaltar, lo comprueba). */}
              <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">R{release.number}</span>
              <Highlight text={` ${release.title}`} query={query} />
            </button>
          </h2>
          <p className="text-xs text-slate-500">
            <Highlight
              query={query}
              text={[
                formatDate(date, "dateTime", locale),
                release.author,
                release.taskCount === 1 ? t("1 tarea") : t("{n} tareas", { n: release.taskCount }),
                attachments.length > 0 ? (attachments.length === 1 ? t("1 adjunto") : t("{n} adjuntos", { n: attachments.length })) : null,
              ].filter(Boolean).join(" · ")}
            />
          </p>
        </div>
        <ChevronDown size={18} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
      </div>
      {open && (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* Hasta que llega el texto, Copiar y las descargas esperan (desactivados). */}
            <button className="btn-secondary py-1.5" disabled={text === null} onClick={async () => { if (text === null) return; if (await copyText(text)) toast(t("Copiado al portapapeles")); else toast(t("No se pudo copiar"), "error"); }}>
              <ClipboardCopy size={15} /> {t("Copiar")}
            </button>
            <button className="btn-secondary py-1.5" disabled={text === null} onClick={() => text !== null && downloadText(text, releaseFileName({ day: isoDate(date, appTimeZone()), number: release.number, project: projectName }, "md"), "text/markdown")}>
              <Download size={15} /> .md
            </button>
            <button className="btn-secondary py-1.5" disabled={text === null} onClick={() => text !== null && downloadText(text, releaseFileName({ day: isoDate(date, appTimeZone()), number: release.number, project: projectName }, "txt"), "text/plain")}>
              <Download size={15} /> .txt
            </button>
            {/* Borrar va aparte, en «⋯» al final de la fila: junto a Copiar/.md/.txt se pulsaba sin querer. */}
            <Menu
              align="end"
              className="ml-auto"
              label={t("Más acciones de la release R{number}", { number: release.number })}
              panelClassName="w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
              trigger={({ props }) => (
                <button type="button" className="btn-icon" aria-label={t("Más acciones de la release R{number}", { number: release.number })} title={t("Más acciones")} {...props}>
                  <MoreHorizontal size={18} aria-hidden />
                </button>
              )}
            >
              {attachments.length > 0 && (
                <MenuItem icon={Trash2} danger disabled={busy} onClick={() => void removeAttachments()}>{t("Borrar adjuntos")}</MenuItem>
              )}
              <MenuItem icon={Trash2} danger disabled={busy} onClick={() => void remove()}>{t("Borrar release")}</MenuItem>
            </Menu>
          </div>
          {attachments.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t("Adjuntos ({n})", { n: attachments.length })}</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {Array.from({ length: parts }, (_, i) => (
                    <button key={i} className="btn-secondary py-1.5" disabled={downloading} onClick={() => void downloadPart(i + 1)}>
                      <FileArchive size={15} /> {parts > 1 ? t("Descargar adjuntos ({part}/{total})", { part: i + 1, total: parts }) : t("Descargar adjuntos")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 break-words text-xs text-slate-500"><Highlight text={attachments.join(", ")} query={query} /></p>
            </div>
          )}
          {body ?? (loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-slate-500" role="status"><Loader2 size={15} className="animate-spin" aria-hidden /> {t("Cargando…")}</p>
          ))}
        </div>
      )}
    </article>
  );
}
