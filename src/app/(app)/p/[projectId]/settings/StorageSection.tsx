"use client";

import { Archive, FileText, HardDrive, Image as ImageIcon, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteStorageItem, previewStorageCleanup, refreshProjectStorage, runStorageCleanup, setProjectStorageQuota } from "@/actions/storage";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatQuotaMb, formatSize } from "@/lib/format-size";
import type { QuotaSource } from "@/lib/quota";
import { actionThrowResult } from "@/lib/stale-action";
import type { LargeAttachment, ProjectStorage } from "@/lib/storage-stats";

type Kind = "archivedTasks" | "documentsTrash" | "oldReleases";

/** Pestaña «Adjuntos y límites»: cuánto ocupa el proyecto frente a su cuota y cómo liberar espacio (solo quien gestiona el proyecto). */
export function StorageSection({ projectId, isAdmin, initial, initialLargest }: { projectId: string; isAdmin: boolean; initial: ProjectStorage; initialLargest: LargeAttachment[] }) {
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [storage, setStorage] = useState(initial);
  const [largest, setLargest] = useState(initialLargest);
  const [archivedDays, setArchivedDays] = useState(0);
  const [releaseDays, setReleaseDays] = useState(90);
  const [quotaText, setQuotaText] = useState(storage.override === null ? "" : String(storage.override));
  const [busy, setBusy] = useState<string | null>(null);

  const fmt = (n: number) => formatSize(n, locale);
  const files = (n: number) => (n === 1 ? t("1 fichero") : t("{n} ficheros", { n }));
  const quotaBytes = storage.quotaMb === null ? null : storage.quotaMb * 1024 * 1024;
  const pct = quotaBytes ? Math.min(100, Math.round((storage.usedBytes / quotaBytes) * 100)) : null;
  const over = quotaBytes !== null && storage.usedBytes >= quotaBytes;

  const reload = async () => {
    const res = await refreshProjectStorage(projectId).catch((e) => actionThrowResult(e, t));
    if (!res.ok) return toast(res.error, "error");
    setStorage(res.data.storage);
    setLargest(res.data.largest);
  };

  const sourceText: Record<QuotaSource, string> = {
    project: t("Cuota propia de este proyecto."),
    env: t("La cuota general, fijada por el servidor (UPLOAD_QUOTA_MB_PER_PROJECT)."),
    app: t("La cuota general de la instalación."),
    default: t("La cuota general por defecto (10 GB)."),
    none: "",
  };

  const saveQuota = (value: number | null) =>
    start(async () => {
      const res = await setProjectStorageQuota(projectId, value).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      toast(t("Proyecto actualizado"));
      if (value === null) setQuotaText("");
      await reload();
    });

  const cleanup = async (kind: Kind, days: number, text: { title: string; what: string; confirmLabel: string }) => {
    setBusy(kind);
    try {
      const prev = await previewStorageCleanup(projectId, kind, days).catch((e) => actionThrowResult(e, t));
      if (!prev.ok) return toast(prev.error, "error");
      if (prev.data.count === 0) return toast(t("No hay nada que borrar."));
      const ok = await confirm({
        title: text.title,
        danger: true,
        confirmLabel: text.confirmLabel,
        message: (
          <div className="space-y-2">
            <p>{t("Se borrarán {what}: {files}, que ocupan {size}.", { what: text.what, files: files(prev.data.count), size: fmt(prev.data.bytes) })}</p>
            <p className="font-medium">{t("Es definitivo: los ficheros se borran del servidor y no se pueden recuperar ni con «Deshacer». Quedará anotado en el registro de actividad.")}</p>
          </div>
        ),
      });
      if (!ok) return;
      const res = await runStorageCleanup(projectId, kind, days).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      toast(t("Borrados {files}: se han liberado {size}.", { files: files(res.data.count), size: fmt(res.data.bytes) }));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const deleteOne = async (item: LargeAttachment) => {
    const ok = await confirm({
      title: t("Borrar fichero"),
      danger: true,
      confirmLabel: t("Borrar para siempre"),
      message: (
        <div className="space-y-2">
          <p>{t("Se borrará «{name}» ({size}).", { name: item.name, size: fmt(item.size) })}</p>
          <p className="font-medium">{t("Es definitivo: el fichero se borra del servidor y no se puede recuperar ni con «Deshacer».")}</p>
        </div>
      ),
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      const res = await deleteStorageItem(projectId, item.kind, item.id).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      toast(t("Borrado: se han liberado {size}.", { size: fmt(res.data.bytes) }));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const rows: { label: string; part: { count: number; bytes: number } }[] = [
    { label: t("Adjuntos de tareas activas"), part: storage.taskActive },
    { label: t("Adjuntos de tareas archivadas"), part: storage.taskArchived },
    { label: t("Copias en releases"), part: storage.releases },
    { label: t("Documentación"), part: storage.documents },
    { label: t("Papelera de documentación"), part: storage.documentsTrash },
  ];
  const kindLabel = { task: t("Tarea"), release: t("Release"), document: t("Documento") } as const;
  const quotaNumber = Number(quotaText);
  const quotaValid = quotaText.trim() !== "" && Number.isInteger(quotaNumber) && quotaNumber >= 1;
  const days = (n: number) => (n === 0 ? t("todas") : t("de más de {n} días", { n }));

  return (
    <section id="almacenamiento" className="card scroll-mt-4 space-y-5 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><HardDrive size={16} aria-hidden /> {t("Almacenamiento")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{t("Lo que ocupan los ficheros del proyecto (adjuntos de tareas, copias de las releases y documentación, papelera incluida) frente a su cuota. Las miniaturas no cuentan.")}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium">
            {quotaBytes === null ? t("{used} usados · sin límite", { used: fmt(storage.usedBytes) }) : t("{used} de {quota} usados", { used: fmt(storage.usedBytes), quota: formatQuotaMb(storage.quotaMb!, locale) })}
            {pct !== null && <span className={cn("ml-2 text-xs", over ? "text-red-600" : "text-slate-500")}>{pct} %</span>}
          </p>
          <p className="text-xs text-slate-500">{storage.quotaMb === null ? t("Sin cuota: no hay límite de almacenamiento.") : sourceText[storage.quotaSource]}</p>
        </div>
        {quotaBytes !== null && (
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar" aria-label={t("Almacenamiento usado")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}
          >
            <div className={cn("h-full rounded-full transition-[width]", over ? "bg-red-500" : pct! >= 80 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${Math.max(pct!, storage.usedBytes > 0 ? 1 : 0)}%` }} />
          </div>
        )}
        {over && <p className="mt-2 text-sm text-red-600" role="status">{t("El proyecto ha llegado a su cuota: no admite más ficheros hasta que liberes espacio o se amplíe.")}</p>}
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>{r.label}</span>
            <span className="shrink-0 text-slate-600 dark:text-slate-300">{files(r.part.count)} · <span className="font-medium">{fmt(r.part.bytes)}</span></span>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (quotaValid) saveQuota(quotaNumber);
          }}
        >
          <label className="label" htmlFor="p-storage-quota">{t("Cuota de almacenamiento del proyecto (MB)")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="p-storage-quota" className="input w-36" type="number" inputMode="numeric" step={1} min={1}
              placeholder={t("La general")} value={quotaText} onChange={(e) => setQuotaText(e.target.value)}
            />
            <button className="btn-primary py-1.5" disabled={pending || !quotaValid || quotaNumber === storage.override}>{t("Guardar")}</button>
            <button type="button" className="btn-secondary py-1.5" disabled={pending || storage.override === null} onClick={() => saveQuota(null)}>{t("Usar la general")}</button>
          </div>
          <p className="text-xs text-slate-500">{t("Vacío = la cuota general (Administración → Ajustes → Almacenamiento). Una cuota propia manda sobre la general. Solo los administradores pueden cambiarla.")}</p>
        </form>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("Liberar espacio")}</h3>
        <p className="text-xs text-slate-500">{t("Borran los ficheros del servidor para siempre. Antes de borrar se muestra qué se borrará y cuánto espacio se libera.")}</p>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border-2 border-brand-500/60 p-3">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-1.5 text-sm font-medium"><ImageIcon size={14} aria-hidden /> {t("Adjuntos de releases antiguas")}</p>
            <p className="text-xs text-slate-500">{t("Cada release guarda una copia de los adjuntos de sus tareas, que ocupa espacio además de los originales (suele ser lo que más pesa). Quita esas copias; el texto de la release se conserva.")}</p>
          </div>
          <label className="text-xs text-slate-500">
            {t("Releases")}
            <select className="input ml-1 w-auto py-1" value={releaseDays} onChange={(e) => setReleaseDays(Number(e.target.value))} aria-label={t("Antigüedad de las releases")}>
              {[30, 90, 180, 365].map((n) => <option key={n} value={n}>{days(n)}</option>)}
            </select>
          </label>
          <button
            className="btn-secondary py-1.5" disabled={busy !== null}
            onClick={() => cleanup("oldReleases", releaseDays, {
              title: t("Borrar adjuntos de releases antiguas"), confirmLabel: t("Borrar adjuntos"),
              what: t("los adjuntos de las releases de hace más de {n} días", { n: releaseDays }),
            })}
          >
            {busy === "oldReleases" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {t("Borrar adjuntos de releases antiguas")}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-1.5 text-sm font-medium"><Archive size={14} aria-hidden /> {t("Adjuntos de tareas archivadas")}</p>
            <p className="text-xs text-slate-500">{t("Quita los adjuntos pero deja las tareas archivadas con su texto y comentarios.")}</p>
          </div>
          <label className="text-xs text-slate-500">
            {t("Archivadas")}
            <select className="input ml-1 w-auto py-1" value={archivedDays} onChange={(e) => setArchivedDays(Number(e.target.value))} aria-label={t("Antigüedad de las tareas archivadas")}>
              {[0, 30, 90, 365].map((n) => <option key={n} value={n}>{days(n)}</option>)}
            </select>
          </label>
          <button
            className="btn-secondary py-1.5" disabled={busy !== null}
            onClick={() => cleanup("archivedTasks", archivedDays, {
              title: t("Borrar adjuntos de tareas archivadas"), confirmLabel: t("Borrar adjuntos"),
              what: archivedDays === 0 ? t("los adjuntos de las tareas archivadas") : t("los adjuntos de las tareas archivadas hace más de {n} días", { n: archivedDays }),
            })}
          >
            {busy === "archivedTasks" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {t("Borrar adjuntos de tareas archivadas")}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-1.5 text-sm font-medium"><FileText size={14} aria-hidden /> {t("Papelera de documentación")}</p>
            <p className="text-xs text-slate-500">{t("Los documentos borrados siguen ocupando espacio hasta que se purgan (7 días) o los vacías aquí.")}</p>
          </div>
          <button
            className="btn-secondary py-1.5" disabled={busy !== null}
            onClick={() => cleanup("documentsTrash", 0, { title: t("Vaciar la papelera de documentación"), confirmLabel: t("Vaciar papelera"), what: t("los documentos de la papelera") })}
          >
            {busy === "documentsTrash" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {t("Vaciar la papelera de documentación")}
          </button>
        </div>

      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Los 20 ficheros más grandes")}</h3>
        {largest.length === 0 ? (
          <p className="text-sm text-slate-500">{t("Este proyecto no tiene ficheros.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
            {largest.map((a) => (
              <li key={`${a.kind}-${a.id}`} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={a.name}>{a.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {kindLabel[a.kind]}
                    {a.parent && <> · {a.kind === "task" && a.taskId ? <Link className="hover:underline" href={`/p/${projectId}?task=${a.taskId}`}>{a.parent}</Link> : a.parent}</>}
                    {a.flagged && <> · <span className="rounded bg-slate-100 px-1 py-px dark:bg-slate-800">{a.kind === "task" ? t("archivada") : t("en la papelera")}</span></>}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">{fmt(a.size)}</span>
                <button className="btn-icon shrink-0 text-red-600" aria-label={t("Borrar «{name}»", { name: a.name })} disabled={busy !== null} onClick={() => deleteOne(a)}>
                  {busy === a.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
