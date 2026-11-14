"use server";

// «Aplicar plantilla» en Ajustes del proyecto → Tablero (quien puede gestionar el proyecto: administradores y, en un
// proyecto privado, sus miembros). La lógica está en lib/template-apply-core.ts (plan) y lib/template-apply.ts (aplicar y
// deshacer, cada uno en una transacción). Las demás pestañas del proyecto se enteran por el canal en vivo (runAction).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeAction } from "@/lib/action-context";
import { runAction } from "@/lib/action";
import { findManageableProject } from "@/lib/access";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { localizeTemplate } from "@/lib/builtin-templates-en";
import { PROJECT_EXAMPLES } from "@/lib/project-examples";
import { parseStoredTemplate, templateInputSchema, type TemplateData } from "@/lib/project-templates";
import { requireUser } from "@/lib/session";
import { listTemplatesSorted } from "@/lib/template-store";
import { applyTemplateToProject, loadProjectShape, undoTemplateChange as undoChange } from "@/lib/template-apply";
import { releaseTemplateChange, reserveTemplateChange, reserveTemplatePreview, shouldReleaseTemplateChange } from "@/lib/template-apply-rate";
import type { ApplyTemplateShape, ProjectShape, TemplateRef } from "@/lib/template-apply-core";
import * as v from "@/lib/validation";
import { getLocale, getT } from "@/i18n/server";

/** Plantilla que se puede elegir en el asistente. */
export interface ApplicableTemplate {
  ref: TemplateRef;
  name: string;
  description: string;
  /** general: de serie para cualquiera (las de los ejemplos, sin sus tarjetas); installation: Administración → Tipos y plantillas. */
  group: "general" | "installation";
}

/** Límite de cambios de plantilla (lib/template-apply-rate.ts): el aviso, ya traducido, con el código 429. */
async function throwRate(notice: { text: string; vars: Record<string, number> }): Promise<never> {
  throw new AppError((await getT())(notice.text, notice.vars), 429);
}

/**
 * Hace un cambio de plantilla (aplicar o deshacer) dentro del límite. Si no llega a hacerse por un aviso (no cabe, no hay
 * nada que deshacer…), la reserva se devuelve: solo cuentan los cambios hechos, los fallos inesperados y los avisos de
 * un cambio que ya se había ejecutado en la transacción (markTemplateChangeSpent).
 */
async function withinChangeLimit<T>(userId: string, projectId: string, fn: () => Promise<T>): Promise<T> {
  const notice = reserveTemplateChange(userId, projectId);
  if (notice) await throwRate(notice);
  try {
    return await fn();
  } catch (e) {
    if (shouldReleaseTemplateChange(e, e instanceof AppError)) releaseTemplateChange(userId, projectId);
    throw e;
  }
}

const refSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("example"), key: z.string().min(1).max(100) }),
  z.object({ source: z.literal("template"), id: v.id }),
]);

/** Solo la estructura que usa el asistente. */
function shapeOf(t: TemplateData): ApplyTemplateShape {
  return {
    name: t.name,
    columns: t.columns.map((c) => ({ name: c.name, role: c.role, isDone: c.isDone, wipLimit: c.wipLimit ?? null })),
    kinds: t.kinds.map((k) => ({ name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate })),
    labels: t.labels.map((l) => ({ name: l.name, color: l.color })),
    hiddenGeneralKinds: t.hiddenGeneralKinds,
    hideAllGeneralKinds: t.hideAllGeneralKinds,
    taskFields: t.taskFields,
    releaseTemplates: t.releaseTemplates.map((r) => ({ kind: r.kind, name: r.name, content: r.content })),
  };
}

/**
 * La plantilla elegida, en el idioma de quien la aplica. Las de un ejemplo, sin la etiqueta «Ejemplo» ni las tarjetas;
 * las de la instalación, solo para administradores (como al crear un proyecto).
 */
async function resolveRef(rawRef: unknown, isAdmin: boolean, locale: "es" | "en"): Promise<TemplateData> {
  const ref = refSchema.parse(rawRef);
  if (ref.source === "example") {
    const example = PROJECT_EXAMPLES.find((e) => e.key === ref.key);
    if (!example) throw new AppError("La plantilla ya no existe.");
    const content = example[locale];
    return templateInputSchema.parse({ ...content.template, name: content.name, description: content.description });
  }
  if (!isAdmin) throw new AppError("Solo los administradores pueden usar las plantillas de la instalación.");
  const row = await db.projectTemplate.findUnique({ where: { id: ref.id } });
  if (!row) throw new AppError("La plantilla ya no existe.");
  return localizeTemplate(parseStoredTemplate(row), row.builtinKey, locale);
}

/** Plantillas que se pueden aplicar al proyecto: las generales y, para los administradores, las de la instalación. */
export async function listApplicableTemplates(projectId: string) {
  return runAction({ name: "templateApply.listApplicableTemplates", args: [projectId] }, async (): Promise<ApplicableTemplate[]> => {
    const user = await requireUser();
    await findManageableProject(user, projectId);
    const locale = await getLocale();
    const general: ApplicableTemplate[] = PROJECT_EXAMPLES.map((e) => ({ ref: { source: "example", key: e.key }, name: e[locale].name, description: e[locale].description, group: "general" }));
    const installation: ApplicableTemplate[] = user.role === "ADMIN"
      ? (await listTemplatesSorted(db, locale)).map((t) => ({ ref: { source: "template", id: t.id }, name: t.name, description: t.description, group: "installation" }))
      : [];
    return [...general, ...installation];
  });
}

/** La plantilla y el estado actual del proyecto, para que el asistente calcule el emparejamiento y el resumen. */
export async function previewTemplateChange(projectId: string, ref: TemplateRef) {
  return runAction({ name: "templateApply.previewTemplateChange", args: [projectId, ref] }, async (): Promise<{ template: ApplyTemplateShape; project: ProjectShape }> => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const notice = reserveTemplatePreview(user.id);
    if (notice) await throwRate(notice);
    const locale = await getLocale();
    const template = shapeOf(await resolveRef(ref, user.role === "ADMIN", locale));
    return { template, project: await loadProjectShape(db, project.id, locale) };
  });
}

const choicesSchema = z.object({
  columns: z.record(z.string().max(40), z.string().max(80)).default({}),
  kinds: z.record(z.string().max(40), z.string().max(80)).default({}),
});

/**
 * Aplica la plantilla: «ADD» añade lo que falte; «REPLACE» cambia a la plantilla con el emparejamiento elegido (lo que
 * falte, el sugerido). Guarda antes una instantánea para «Deshacer el cambio de plantilla».
 */
export async function applyTemplateChange(projectId: string, ref: TemplateRef, mode: "ADD" | "REPLACE", choices?: { columns?: Record<string, string>; kinds?: Record<string, string> }) {
  return runAction({ name: "templateApply.applyTemplateChange", args: [projectId, ref, mode] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const locale = await getLocale();
    const parsedMode = z.enum(["ADD", "REPLACE"]).parse(mode);
    const data = await resolveRef(ref, user.role === "ADMIN", locale);
    const parsedChoices = parsedMode === "REPLACE" ? choicesSchema.parse(choices ?? {}) : undefined;
    const result = await withinChangeLimit(user.id, project.id, () => applyTemplateToProject({
      projectId: project.id, userId: user.id, locale, templateName: data.name, template: shapeOf(data), mode: parsedMode, choices: parsedChoices,
    }));
    if (parsedMode === "ADD") describeAction("Añadió lo que faltaba de la plantilla «{name}»", { name: data.name }, { result });
    else describeAction("Cambió el proyecto a la plantilla «{name}»", { name: data.name }, { result });
    revalidatePath(`/p/${project.id}`, "layout");
    return result;
  });
}

/** «Deshacer el cambio de plantilla» (el último del proyecto, durante un tiempo limitado). */
export async function undoTemplateChange(projectId: string) {
  return runAction({ name: "templateApply.undoTemplateChange", args: [projectId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const result = await withinChangeLimit(user.id, project.id, () => undoChange(project.id));
    describeAction("Deshizo el cambio a la plantilla «{name}»", { name: result.templateName }, { result });
    revalidatePath(`/p/${project.id}`, "layout");
    return result;
  });
}
