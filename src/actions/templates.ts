"use server";

import { revalidatePath } from "next/cache";
import { visibleProjectsWhere } from "@/lib/access";
import { runAction } from "@/lib/action";
import { MAX_RELEASE_TEMPLATES_PER_KIND, PALETTE } from "@/lib/constants";
import { db } from "@/lib/db";
import { EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE } from "@/lib/edit-conflict-core";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { templateInputSchema, type TemplateInput } from "@/lib/project-templates";
import { MAX_TEMPLATES } from "@/lib/project-templates-core";
import { listTemplatesSorted, lockTemplates, resetBuiltinTemplate, restoreBuiltinTemplates } from "@/lib/template-store";
import { requireAdmin } from "@/lib/session";
import { normalizeTaskFields } from "@/lib/task-fields";
import * as v from "@/lib/validation";
import { getLocale, getT } from "@/i18n/server";
import { cutText } from "@/lib/graphemes";

/**
 * Plantillas de proyecto para el diálogo «Nuevo proyecto» (solo administradores), por orden alfabético: solo lo que
 * enseña (nombre y descripción). Las de serie sin tocar salen en el idioma de quien las ve; para saberlo hay que leerlas
 * enteras y compararlas con la canónica, pero columnas, tipos, etiquetas y textos de release no viajan al navegador
 * (37 KB frente a 3 KB con las 15 de serie). Crear el proyecto lee la plantilla en el servidor.
 */
export async function listTemplates() {
  return runAction({ name: "templates.listTemplates" }, async (): Promise<{ id: string; name: string; description: string }[]> => {
    await requireAdmin();
    return (await listTemplatesSorted(db, await getLocale())).map(({ id, name, description }) => ({ id, name, description }));
  });
}

/**
 * Crea (sin templateId) o actualiza una plantilla. `since`: la versión (`updatedAt`) de la plantilla que se abrió; si
 * otro administrador la guardó, restableció o recuperó después, no se pisa (código `edit_conflict`).
 */
export async function saveTemplate(input: TemplateInput, templateId?: string | null, since?: string) {
  return runAction({ name: "templates.saveTemplate", args: [input, templateId] }, async () => {
    await requireAdmin();
    const data = templateInputSchema.parse(input);
    const row = { name: data.name, description: data.description, columns: data.columns, kinds: data.kinds, hiddenGeneralKinds: data.hiddenGeneralKinds, hideAllGeneralKinds: data.hideAllGeneralKinds, labels: data.labels, taskFields: data.taskFields, releaseTemplates: data.releaseTemplates };
    if (templateId) {
      const id = v.id.parse(templateId);
      const sinceDate = since === undefined ? null : new Date(typeof since === "string" ? since : NaN);
      if (sinceDate && Number.isNaN(sinceDate.getTime())) throw new AppError("Datos no válidos.");
      // Comprobar y escribir en una sola sentencia: dos guardados casi a la vez no pasan los dos.
      const { count } = await db.projectTemplate.updateMany({ where: sinceDate ? { id, updatedAt: sinceDate } : { id }, data: row });
      if (!count) {
        if (!(await db.projectTemplate.count({ where: { id } }))) throw notFound();
        throw new AppError(EDIT_CONFLICT_MESSAGE, 409, EDIT_CONFLICT_CODE);
      }
      revalidatePath("/admin/templates");
      const saved = await db.projectTemplate.findUnique({ where: { id }, select: { updatedAt: true } });
      return { id, version: saved?.updatedAt.toISOString() };
    }
    // Recuento y alta con un candado común: dos altas a la vez no pasan del máximo.
    const created = await db.$transaction(async (tx) => {
      await lockTemplates(tx);
      if ((await tx.projectTemplate.count()) >= MAX_TEMPLATES) {
        const t = await getT();
        throw new AppError(t("Máximo {n} plantillas.", { n: MAX_TEMPLATES }));
      }
      const last = await tx.projectTemplate.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
      return tx.projectTemplate.create({ data: { ...row, position: (last?.position ?? 0) + POSITION_STEP }, select: { id: true, updatedAt: true } });
    });
    revalidatePath("/admin/templates");
    return { id: created.id, version: created.updatedAt.toISOString() };
  });
}

export async function deleteTemplate(templateId: string) {
  return runAction({ name: "templates.deleteTemplate", args: [templateId] }, async () => {
    await requireAdmin();
    const { count } = await db.projectTemplate.deleteMany({ where: { id: v.id.parse(templateId) } });
    if (!count) throw notFound();
    revalidatePath("/admin/templates");
  });
}

/** Restablece una plantilla de serie a su contenido original. */
export async function resetTemplate(templateId: string) {
  return runAction({ name: "templates.resetTemplate", args: [templateId] }, async () => {
    await requireAdmin();
    if (!(await resetBuiltinTemplate(db, v.id.parse(templateId)))) throw notFound();
    revalidatePath("/admin/templates");
  });
}

/**
 * Recrea las plantillas de serie que se borraron, hasta el máximo de plantillas. Devuelve cuántas recuperó y cuántas no
 * cabían; si faltaba alguna y no cabe ninguna, falla con el mismo error que crear una.
 */
export async function restoreDefaultTemplates() {
  return runAction({ name: "templates.restoreDefaultTemplates" }, async () => {
    await requireAdmin();
    const res = await db.$transaction(async (tx) => {
      await lockTemplates(tx);
      return restoreBuiltinTemplates(tx);
    });
    if (!res.restored && res.left) {
      const t = await getT();
      throw new AppError(t("Máximo {n} plantillas.", { n: MAX_TEMPLATES }));
    }
    revalidatePath("/admin/templates");
    return res;
  });
}

/** Datos de una plantilla a partir de un proyecto visible: columnas, tipos propios, generales ocultos y etiquetas. */
export async function templateFromProject(projectId: string) {
  return runAction({ name: "templates.templateFromProject", args: [projectId] }, async (): Promise<TemplateInput> => {
    const user = await requireAdmin();
    const project = await db.project.findFirst({
      where: { id: v.id.parse(projectId), ...visibleProjectsWhere(user) },
      select: {
        name: true,
        description: true,
        columns: { orderBy: { position: "asc" }, select: { name: true, role: true, isDone: true, wipLimit: true } },
        kinds: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } },
        hiddenKinds: { select: { kind: { select: { name: true } } } },
        labels: { orderBy: { name: "asc" }, select: { name: true, color: true } },
        taskFields: true,
        releaseTemplates: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { kind: true, name: true, content: true } },
      },
    });
    if (!project) throw notFound();
    const palette: readonly string[] = PALETTE;
    // En el idioma de quien la crea (es el nombre propuesto en el formulario).
    const t = await getT();
    return {
      name: cutText(t("Plantilla de {name}", { name: project.name }), 80),
      description: "",
      columns: project.columns.slice(0, 20),
      kinds: project.kinds.map((k) => ({ ...k, color: k.color.toLowerCase() })),
      hiddenGeneralKinds: project.hiddenKinds.map((h) => h.kind.name),
      labels: project.labels.map((l) => ({ name: l.name, color: (palette.includes(l.color) ? l.color : PALETTE[0]) as (typeof PALETTE)[number] })),
      taskFields: normalizeTaskFields(project.taskFields),
      // Máximo 20 de cada tipo (el tope de la plantilla, igual que el del proyecto).
      releaseTemplates: (["HEADER", "FOOTER"] as const).flatMap((kind) => project.releaseTemplates.filter((r) => r.kind === kind).slice(0, MAX_RELEASE_TEMPLATES_PER_KIND).map((r) => ({ ...r, kind }))),
    };
  });
}
