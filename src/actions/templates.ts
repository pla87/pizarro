"use server";

import { revalidatePath } from "next/cache";
import { visibleProjectsWhere } from "@/lib/access";
import { runAction } from "@/lib/action";
import { PALETTE } from "@/lib/constants";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { templateInputSchema, type TemplateDto, type TemplateInput } from "@/lib/project-templates";
import { listTemplatesSorted, resetBuiltinTemplate, restoreBuiltinTemplates } from "@/lib/template-store";
import { requireAdmin } from "@/lib/session";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";

const MAX_TEMPLATES = 50;

/** Plantillas de proyecto (solo administradores), por orden alfabético. */
export async function listTemplates() {
  return runAction({ name: "templates.listTemplates" }, async (): Promise<TemplateDto[]> => {
    await requireAdmin();
    return listTemplatesSorted(db);
  });
}

/** Crea (sin templateId) o actualiza una plantilla. */
export async function saveTemplate(input: TemplateInput, templateId?: string | null) {
  return runAction({ name: "templates.saveTemplate", args: [input, templateId] }, async () => {
    await requireAdmin();
    const data = templateInputSchema.parse(input);
    const row = { name: data.name, description: data.description, columns: data.columns, kinds: data.kinds, hiddenGeneralKinds: data.hiddenGeneralKinds, hideAllGeneralKinds: data.hideAllGeneralKinds, labels: data.labels };
    if (templateId) {
      const id = v.id.parse(templateId);
      if (!(await db.projectTemplate.count({ where: { id } }))) throw notFound();
      await db.projectTemplate.update({ where: { id }, data: row });
      revalidatePath("/admin/templates");
      return { id };
    }
    if ((await db.projectTemplate.count()) >= MAX_TEMPLATES) {
      const t = await getT();
      throw new AppError(t("Máximo {n} plantillas.", { n: MAX_TEMPLATES }));
    }
    const last = await db.projectTemplate.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const created = await db.projectTemplate.create({ data: { ...row, position: (last?.position ?? 0) + POSITION_STEP }, select: { id: true } });
    revalidatePath("/admin/templates");
    return created;
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

/** Recrea las plantillas de serie que se borraron. Devuelve cuántas. */
export async function restoreDefaultTemplates() {
  return runAction({ name: "templates.restoreDefaultTemplates" }, async () => {
    await requireAdmin();
    const restored = await restoreBuiltinTemplates(db);
    revalidatePath("/admin/templates");
    return { restored };
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
        columns: { orderBy: { position: "asc" }, select: { name: true, role: true, isDone: true } },
        kinds: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } },
        hiddenKinds: { select: { kind: { select: { name: true } } } },
        labels: { orderBy: { name: "asc" }, select: { name: true, color: true } },
      },
    });
    if (!project) throw notFound();
    const palette: readonly string[] = PALETTE;
    return {
      name: `Plantilla de ${project.name}`.slice(0, 80),
      description: "",
      columns: project.columns.slice(0, 20),
      kinds: project.kinds.map((k) => ({ ...k, color: k.color.toLowerCase() })),
      hiddenGeneralKinds: project.hiddenKinds.map((h) => h.kind.name),
      labels: project.labels.map((l) => ({ name: l.name, color: (palette.includes(l.color) ? l.color : PALETTE[0]) as (typeof PALETTE)[number] })),
    };
  });
}
