"use client";

import { HardDrive, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveStorageQuotas } from "@/actions/storage";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/Toast";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatQuotaMb, formatSize } from "@/lib/format-size";
import { QUOTA_MAX_MB, QUOTA_MIN_MB, quotaMbValid } from "@/lib/quota";
import { actionThrowResult } from "@/lib/stale-action";
import type { StorageAdminView } from "@/lib/storage-stats";

/** Administración → Ajustes → «Almacenamiento»: dónde están los ficheros, cuánto ocupan y las cuotas generales. */
export function StorageSettingsSection({ view }: { view: StorageAdminView }) {
  const t = useT();
  const locale = useIntlLocale();
  const toast = useToast();
  const [pending, start] = useTransition();
  const fmt = (n: number) => formatSize(n, locale);

  const initialProject = view.settings.project;
  const [projectUnlimited, setProjectUnlimited] = useState(initialProject.mode === "unlimited");
  const [projectText, setProjectText] = useState(initialProject.mode === "custom" ? String(initialProject.mb) : "");
  const [totalText, setTotalText] = useState(view.settings.total.mode === "custom" ? String(view.settings.total.mb) : "");

  const projectNum = Number(projectText);
  const totalNum = Number(totalText);
  // Los mismos topes que el servidor (QUOTA_MIN_MB…QUOTA_MAX_MB): antes se aceptaba 99999999999999 y fallaba al guardar.
  const projectValid = projectUnlimited || projectText.trim() === "" || quotaMbValid(projectText);
  const totalValid = totalText.trim() === "" || quotaMbValid(totalText);

  const save = () =>
    start(async () => {
      const project = projectUnlimited ? { mode: "unlimited" as const } : projectText.trim() === "" ? { mode: "default" as const } : { mode: "custom" as const, mb: projectNum };
      const total = totalText.trim() === "" ? { mode: "default" as const } : { mode: "custom" as const, mb: totalNum };
      const res = await saveStorageQuotas({ project, total }).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      toast(t("Ajuste guardado."), "success");
    });

  const usedPct = view.disk ? Math.round(((view.disk.total - view.disk.free) / view.disk.total) * 100) : null;
  const c = view.categories;
  const cats = [
    { label: t("Adjuntos de tareas"), bytes: c.taskAttachments },
    { label: t("Copias de adjuntos en releases"), bytes: c.releaseAttachments },
    { label: t("Documentación"), bytes: c.documents },
    { label: t("Papelera de documentación"), bytes: c.documentsTrash },
  ];
  const envNote = (name: string) => t("Fijada por la variable de entorno {name} del servidor: para cambiarla desde aquí, quita la variable.", { name });
  const effectiveProject = view.effective.projectMb === null ? t("Sin límite") : formatQuotaMb(view.effective.projectMb, locale);

  return (
    <section className="card space-y-5 p-5" aria-labelledby="storage-title">
      <div>
        <h2 id="storage-title" className="flex items-center gap-2 text-sm font-semibold"><HardDrive size={16} aria-hidden /> {t("Almacenamiento")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("Dónde se guardan los ficheros, cuánto ocupan y cuánto puede ocupar cada proyecto.")}</p>
      </div>

      <div className="space-y-1 text-sm">
        <p>
          <span className="text-slate-500">{t("Carpeta de ficheros:")}</span> <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{view.uploadDir}</code>
        </p>
        <p className="text-xs text-slate-500">{t("En Railway es el volumen montado en esa ruta; su tamaño se cambia en Railway (volumen → Settings → Size), no aquí. Las copias de seguridad locales y las exportaciones también se guardan ahí.")}</p>
        {view.disk ? (
          <>
            <p>
              <span className="text-slate-500">{t("Disco:")}</span> {t("{used} usados de {total} · {free} libres", { used: fmt(view.disk.total - view.disk.free), total: fmt(view.disk.total), free: fmt(view.disk.free) })}
              {usedPct !== null && <span className="ml-1 text-xs text-slate-500">({usedPct} %)</span>}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-label={t("Disco usado")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct ?? 0}>
              <div className={cn("h-full rounded-full", (usedPct ?? 0) >= 90 ? "bg-red-500" : (usedPct ?? 0) >= 75 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${usedPct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">{t("El sistema no informa del espacio del disco.")}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t("Lo que ocupa Pizarro")}: {fmt(view.trackedBytes)}</h3>
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
          {cats.map((x) => (
            <li key={x.label} className="flex justify-between gap-3 px-3 py-1.5"><span>{x.label}</span><span className="tabular-nums">{fmt(x.bytes)}</span></li>
          ))}
          <li className="flex justify-between gap-3 px-3 py-1.5 text-slate-500"><span>{t("Copias de seguridad locales (no cuentan en las cuotas)")}</span><span className="tabular-nums">{fmt(c.backups)}</span></li>
          <li className="flex justify-between gap-3 px-3 py-1.5 text-slate-500"><span>{t("Ficheros de exportación (no cuentan en las cuotas)")}</span><span className="tabular-nums">{fmt(c.exports)}</span></li>
        </ul>
        <p className="mt-1 text-xs text-slate-500">{t("Suma de los tamaños registrados; las miniaturas de las imágenes no se cuentan, así que el disco puede marcar algo más.")}</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t("Proyectos que más ocupan")}</h3>
        {view.topProjects.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">{t("Todavía no hay ficheros.")}</p>
        ) : (
          <ol className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
            {view.topProjects.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 px-3 py-1.5">
                {p.name ? <Link className="min-w-0 truncate text-brand-700 hover:underline dark:text-brand-300" href={`/p/${p.id}/settings?tab=adjuntos`}>{p.name}</Link> : <span className="text-slate-500">{t("Proyecto privado")}</span>}
                <span className="shrink-0 tabular-nums">{fmt(p.bytes)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{t("Cuotas")}</h3>
        <div className="space-y-1.5">
          <label htmlFor="quota-project" className="label">{t("Cuota por proyecto (MB)")}</label>
          {view.env.project !== null ? (
            <>
              <p className="text-sm">{formatQuotaMb(view.env.project, locale)} <span className="text-xs text-slate-500">({view.env.project} MB)</span></p>
              <p className="text-xs text-slate-500">{envNote("UPLOAD_QUOTA_MB_PER_PROJECT")}</p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="quota-project" className="input w-36" type="number" inputMode="numeric" min={QUOTA_MIN_MB} max={QUOTA_MAX_MB} step={1} placeholder="10240"
                  disabled={projectUnlimited} value={projectText} onChange={(e) => setProjectText(e.target.value)}
                />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={projectUnlimited} onChange={(e) => setProjectUnlimited(e.target.checked)} /> {t("Sin límite")}
                </label>
              </div>
              <p className="text-xs text-slate-500">{t("Lo que puede ocupar cada proyecto (adjuntos, copias en releases y documentación). Vacío = 10 GB (10240 MB). Un proyecto puede tener su propia cuota en sus ajustes. Ahora mismo: {value}.", { value: effectiveProject })}</p>
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="quota-total" className="label">{t("Cuota total del servidor (MB, opcional)")}</label>
          {view.env.total !== null ? (
            <>
              <p className="text-sm">{formatQuotaMb(view.env.total, locale)} <span className="text-xs text-slate-500">({view.env.total} MB)</span></p>
              <p className="text-xs text-slate-500">{envNote("UPLOAD_QUOTA_MB_TOTAL")}</p>
            </>
          ) : (
            <>
              <input id="quota-total" className="input w-36" type="number" inputMode="numeric" min={QUOTA_MIN_MB} max={QUOTA_MAX_MB} step={1} placeholder={t("Sin límite")} value={totalText} onChange={(e) => setTotalText(e.target.value)} />
              <p className="text-xs text-slate-500">{t("Tope de todo lo que suman los proyectos. Vacío = sin tope. Pon un valor algo menor que el tamaño de tu volumen para que los proyectos no lo llenen.")}</p>
            </>
          )}
        </div>
        {(view.env.project === null || view.env.total === null) && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary py-1.5" onClick={save} disabled={pending || !projectValid || !totalValid}>
              {pending && <Loader2 size={15} className="animate-spin" />} {t("Guardar")}
            </button>
            {(!projectValid || !totalValid) && <span className="text-xs text-red-600" role="alert">{t("Debe ser un número entero de MB, entre {min} y {max}.", { min: QUOTA_MIN_MB, max: QUOTA_MAX_MB.toLocaleString(locale) })}</span>}
          </div>
        )}
      </div>
    </section>
  );
}
