"use client";

// «Aplicar plantilla» (Ajustes del proyecto → Tablero): asistente en tres pasos. 1) plantilla y qué hacer («Añadir lo que
// falte» o «Cambiar a esta plantilla»); 2) solo al cambiar: emparejar columnas y tipos (con la sugerencia ya puesta);
// 3) resumen y aplicar. El plan se calcula aquí con las mismas funciones que usa el servidor (template-apply-core.ts),
// que lo vuelve a calcular al aplicar. Tras aplicar, «Deshacer el cambio de plantilla» durante TEMPLATE_UNDO_HOURS.
import { ArrowRight, LayoutTemplate, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { applyTemplateChange, listApplicableTemplates, previewTemplateChange, undoTemplateChange, type ApplicableTemplate } from "@/actions/template-apply";
import { useIntlLocale, useT } from "@/i18n/client";
import { COLUMN_ROLE_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  listedKinds, planAdd, planIsEmpty, planReplace, resolveTemplateKinds, suggestColumnChoices, suggestKindChoices, summarizePlan, TEMPLATE_UNDO_HOURS, visibleGeneralsAfter,
  type ApplyMode, type ApplyTemplateShape, type ProjectShape, type TemplateRef,
} from "@/lib/template-apply-core";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useActionTransition } from "@/components/useActionTransition";

/** Último cambio de plantilla que aún se puede deshacer (lo lee la página). */
export interface LastTemplateChange {
  templateName: string;
  mode: ApplyMode;
  createdAt: string;
  until: string;
  userName: string | null;
}

const refKey = (ref: TemplateRef) => (ref.source === "example" ? `example:${ref.key}` : `template:${ref.id}`);
const roleLabel = (role: string) => (COLUMN_ROLE_LABEL as Record<string, string>)[role] ?? role;

export function ApplyTemplate({ projectId, lastChange }: { projectId: string; lastChange: LastTemplateChange | null }) {
  const t = useT();
  const intl = useIntlLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useActionTransition();
  const [open, setOpen] = useState(false);

  const undo = async () => {
    if (!lastChange) return;
    const ok = await confirm({
      title: t("Deshacer el cambio de plantilla"),
      message: t("Las columnas, tipos y etiquetas vuelven a como estaban antes de aplicar «{name}» y las tareas movidas vuelven a su sitio. Lo que haya recibido tareas después se conserva.", { name: lastChange.templateName }),
      confirmLabel: t("Deshacer"),
    });
    if (!ok) return;
    start(async () => {
      const res = await undoTemplateChange(projectId);
      if (!res.ok) return toast(res.error, "error");
      const kept = res.data.keptColumns + res.data.keptKinds;
      toast(kept ? t("Cambio de plantilla deshecho. Se conservan {n} columnas o tipos nuevos porque ya tienen tareas.", { n: kept }) : t("Cambio de plantilla deshecho"));
      router.refresh();
    });
  };

  return (
    <div className="space-y-3" data-apply-template>
      {lastChange && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40" data-template-undo>
          <p>
            {lastChange.mode === "ADD"
              ? t("Se añadió lo que faltaba de «{name}»", { name: lastChange.templateName })
              : t("Se cambió el proyecto a «{name}»", { name: lastChange.templateName })}
            {lastChange.userName ? ` (${lastChange.userName})` : ""}
            {" · "}
            <span suppressHydrationWarning>{formatDate(lastChange.createdAt, "dateTimeShort", intl)}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            {t("Se puede deshacer hasta el")} <span suppressHydrationWarning>{formatDate(lastChange.until, "dateTimeShort", intl)}</span>.
          </p>
          <button type="button" className="btn-secondary mt-2" disabled={pending} onClick={undo}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />} {t("Deshacer el cambio de plantilla")}
          </button>
        </div>
      )}
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <LayoutTemplate size={15} /> {t("Aplicar plantilla…")}
      </button>
      {open && <ApplyWizard projectId={projectId} onClose={() => setOpen(false)} onApplied={() => { setOpen(false); router.refresh(); }} />}
    </div>
  );
}

function ApplyWizard({ projectId, onClose, onApplied }: { projectId: string; onClose: () => void; onApplied: () => void }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<ApplicableTemplate[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [mode, setMode] = useState<ApplyMode>("ADD");
  const [preview, setPreview] = useState<{ key: string; template: ApplyTemplateShape; project: ProjectShape } | null>(null);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // La lista se pide al abrir el asistente.
  useEffect(() => {
    let live = true;
    listApplicableTemplates(projectId).then(
      (res) => live && (res.ok ? setTemplates(res.data) : setLoadError(res.error)),
      () => live && setLoadError(t("Sin conexión: no se ha guardado")),
    );
    return () => { live = false; };
  }, [projectId, t]);
  const chosen = templates?.find((x) => refKey(x.ref) === selected) ?? null;

  const next = () => {
    if (!chosen) return;
    const key = refKey(chosen.ref);
    start(async () => {
      let data = preview?.key === key ? preview : null;
      if (!data) {
        const res = await previewTemplateChange(projectId, chosen.ref);
        if (!res.ok) return toast(res.error, "error");
        data = { key, ...res.data };
        setPreview(data);
        setColumns(suggestColumnChoices(data.project, data.template));
        setKinds(suggestKindChoices(data.project, data.template));
      }
      setStep(mode === "REPLACE" ? 2 : 3);
    });
  };

  const plan = useMemo(() => {
    if (!preview) return null;
    return mode === "ADD" ? planAdd(preview.project, preview.template) : planReplace(preview.project, preview.template, { columns, kinds });
  }, [preview, mode, columns, kinds]);

  const apply = () => {
    if (!chosen || !plan) return;
    start(async () => {
      const res = await applyTemplateChange(projectId, chosen.ref, mode, mode === "REPLACE" ? { columns, kinds } : undefined);
      if (!res.ok) return toast(res.error, "error");
      toast(mode === "ADD" ? t("Añadido lo que faltaba de la plantilla") : t("Plantilla aplicada"));
      onApplied();
    });
  };

  const totalSteps = mode === "REPLACE" ? 3 : 2;
  const shownStep = step === 3 && mode === "ADD" ? 2 : step;
  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      {step === 1 ? (
        <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
      ) : (
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => setStep(step === 3 && mode === "REPLACE" ? 2 : 1)}>{t("Atrás")}</button>
      )}
      {step === 1 && (
        <button type="button" className="btn-primary" disabled={pending || !chosen} onClick={next}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Siguiente")}
        </button>
      )}
      {step === 2 && <button type="button" className="btn-primary" onClick={() => setStep(3)}>{t("Siguiente")}</button>}
      {step === 3 && preview && plan && (
        <button type="button" className="btn-primary" disabled={pending || plan.errors.length > 0 || planIsEmpty(plan, preview.project, preview.template)} onClick={apply}>
          {pending && <Loader2 size={15} className="animate-spin" />} {t("Aplicar")}
        </button>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} size="lg" title={`${t("Aplicar plantilla")} · ${t("Paso {n} de {total}", { n: shownStep, total: totalSteps })}`} footer={footer}>
      {step === 1 && (
        <div className="space-y-4" data-step="1">
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {!templates && !loadError && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> {t("Cargando…")}</p>}
          {templates && (["general", "installation"] as const).map((group) => {
            const list = templates.filter((x) => x.group === group);
            if (!list.length) return null;
            return (
              <fieldset key={group}>
                <legend className="mb-1.5 text-xs font-medium text-slate-500">{group === "general" ? t("Plantillas generales") : t("Plantillas de la instalación")}</legend>
                <div className="space-y-1.5">
                  {list.map((x) => (
                    <label key={refKey(x.ref)} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", selected === refKey(x.ref) ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30" : "border-slate-200 dark:border-slate-700")}>
                      <input type="radio" name="apply-template" className="mt-1" checked={selected === refKey(x.ref)} onChange={() => setSelected(refKey(x.ref))} />
                      <span className="min-w-0">
                        <span className="font-medium">{x.name}</span>
                        {x.description && <span className="block text-xs text-slate-500">{x.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-slate-500">{t("Qué hacer")}</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="apply-mode" className="mt-1" checked={mode === "ADD"} onChange={() => setMode("ADD")} />
              <span>
                {t("Añadir lo que falte de la plantilla")}
                <span className="block text-xs text-slate-500">{t("Añade las columnas, tipos, etiquetas, campos y plantillas de release que el proyecto no tenga. No cambia ni quita nada.")}</span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="radio" name="apply-mode" className="mt-1" checked={mode === "REPLACE"} onChange={() => setMode("REPLACE")} />
              <span>
                {t("Cambiar a esta plantilla")}
                <span className="block text-xs text-slate-500">{t("Empareja las columnas y los tipos actuales con los de la plantilla y lleva allí sus tareas. Nunca se quita nada que tenga tareas.")}</span>
              </span>
            </label>
          </fieldset>
        </div>
      )}

      {step === 2 && preview && plan?.mode === "REPLACE" && (
        <MatchStep preview={preview} columns={columns} kinds={kinds} setColumns={setColumns} setKinds={setKinds} />
      )}

      {step === 3 && preview && plan && (
        <div className="space-y-3" data-step="3">
          <p className="text-sm font-medium">«{preview.template.name}»</p>
          {plan.errors.map((e) => <p key={e.text} className="text-sm text-red-600" role="alert">{t(e.text, e.vars)}</p>)}
          {planIsEmpty(plan, preview.project, preview.template) ? (
            <p className="text-sm text-slate-600 dark:text-slate-400" data-summary-empty>{t("El proyecto ya tiene todo lo de esta plantilla: no hay nada que cambiar.")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm" data-summary>
              {summarizePlan(plan, preview.project, preview.template).map((line) => (
                <li key={line.text} className="flex gap-2">
                  <ArrowRight size={14} className="mt-1 shrink-0 text-slate-400" aria-hidden />
                  <span>
                    {t(line.text, { n: line.n })}
                    {line.names && <span className="block text-xs break-words text-slate-500">{line.names.join(", ")}</span>}
                  </span>
                </li>
              ))}
              {plan.mode === "REPLACE" && <li className="text-xs text-slate-500">{t("Si queda alguna columna de la plantilla vacía o sin pareja, se crea igualmente. Las etiquetas en uso se conservan.")}</li>}
            </ul>
          )}
          <p className="text-xs text-slate-500">{t("Antes de aplicar se guarda cómo está el proyecto: durante {h} horas podrás deshacerlo desde aquí con «Deshacer el cambio de plantilla».", { h: TEMPLATE_UNDO_HOURS })}</p>
        </div>
      )}
    </Modal>
  );
}

/** Paso 2: a qué columna y tipo de la plantilla va cada uno de los actuales. */
function MatchStep({ preview, columns, kinds, setColumns, setKinds }: {
  preview: { template: ApplyTemplateShape; project: ProjectShape };
  columns: Record<string, string>;
  kinds: Record<string, string>;
  setColumns: (f: (c: Record<string, string>) => Record<string, string>) => void;
  setKinds: (f: (c: Record<string, string>) => Record<string, string>) => void;
}) {
  const t = useT();
  const { template, project } = preview;
  const targets = resolveTemplateKinds(project, template);
  const generals = visibleGeneralsAfter(project, template);
  const n = (count: number) => (count === 1 ? t("1 tarea") : t("{n} tareas", { n: count }));
  return (
    <div className="space-y-5" data-step="2">
      <section>
        <h3 className="text-sm font-semibold">{t("Columnas")}</h3>
        <p className="mb-2 text-xs text-slate-500">{t("Las tareas de cada columna pasan a la que elijas. Una sin pareja se conserva al final; si está vacía, se puede quitar.")}</p>
        <ul className="space-y-2">
          {project.columns.map((c) => {
            const empty = c.active + c.archived === 0;
            return (
              <li key={c.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3" data-match-column={c.name}>
                <span className="min-w-0 text-sm">
                  <span className="font-medium break-words">{c.name}</span>{" "}
                  <span className="text-xs text-slate-500">{n(c.active)}{c.role !== "NONE" ? ` · ${t(roleLabel(c.role))}` : ""}</span>
                </span>
                <select className="input" aria-label={t("Destino de «{name}»", { name: c.name })} value={columns[c.id] ?? "keep"} onChange={(e) => { const value = e.target.value; setColumns((m) => ({ ...m, [c.id]: value })); }}>
                  <optgroup label={t("Pasa a la columna de la plantilla")}>
                    {template.columns.map((tc, i) => <option key={i} value={`t:${i}`}>{tc.name}{tc.role !== "NONE" ? ` (${t(roleLabel(tc.role))})` : ""}</option>)}
                  </optgroup>
                  <option value="keep">{t("Conservar al final")}</option>
                  {empty && <option value="drop">{t("Quitar (está vacía)")}</option>}
                </select>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">{t("Tipos de tarea")}</h3>
        <p className="mb-2 text-xs text-slate-500">{t("Las tareas de cada tipo pasan al que elijas, o el tipo se conserva.")}</p>
        <ul className="space-y-2">
          {listedKinds(project).map((k) => {
            const same = targets.findIndex((x) => "existing" in x && x.existing === k.id);
            return (
              <li key={k.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3" data-match-kind={k.label}>
                <span className="min-w-0 text-sm">
                  <span className="font-medium break-words">{k.label}</span>{" "}
                  <span className="text-xs text-slate-500">{n(k.tasks)}{k.general ? ` · ${t("general")}` : ""}</span>
                </span>
                {same >= 0 ? (
                  <span className="text-sm text-slate-600 dark:text-slate-400">{t("Ya está en la plantilla")}</span>
                ) : (
                  <select className="input" aria-label={t("Destino de «{name}»", { name: k.label })} value={kinds[k.id] ?? "keep"} onChange={(e) => { const value = e.target.value; setKinds((m) => ({ ...m, [k.id]: value })); }}>
                    <option value="keep">{t("Conservar")}</option>
                    {!k.general && k.tasks === 0 && <option value="drop">{t("Quitar (no tiene tareas)")}</option>}
                    {template.kinds.length > 0 && (
                      <optgroup label={t("Pasa al tipo de la plantilla")}>
                        {template.kinds.map((tk, i) => <option key={i} value={`t:${i}`}>{tk.name}</option>)}
                      </optgroup>
                    )}
                    {generals.some((g) => g.id !== k.id) && (
                      <optgroup label={t("Pasa a un tipo general")}>
                        {generals.filter((g) => g.id !== k.id).map((g) => <option key={g.id} value={`g:${g.id}`}>{g.label}</option>)}
                      </optgroup>
                    )}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
