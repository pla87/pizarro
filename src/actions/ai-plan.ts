"use server";

import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { AI_PLAN_MAX_TASKS, aiPlanFileName, highestPlanVersion } from "@/lib/ai-plan";
import { projectPlanTemplates, userPlanTemplates } from "@/lib/ai-plan-templates";
import { MAX_RELEASE_CONTENT } from "@/lib/constants";
import { todayIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { saveGeneratedDocument } from "@/lib/documents";
import { AppError } from "@/lib/errors";
import { appTimeZone } from "@/lib/format";
import { quotaError } from "@/lib/quota-message";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { intlLocale } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";

/**
 * Prefijo de los documentos de plan, en los dos idiomas (la versión se cuenta con los de cualquiera de ellos). El inglés
 * es la traducción de «Plan de trabajo» (tests/ai-plan.test.ts comprueba que coinciden).
 */
const PLAN_PREFIX = "Plan de trabajo";
const PLAN_PREFIXES = [PLAN_PREFIX, "Work plan"];

/** Mayor versión de plan guardada en la Documentación del proyecto (también las que están en la papelera). */
async function highestSavedVersion(projectId: string): Promise<number> {
  const docs = await db.projectDocument.findMany({
    where: { projectId, OR: PLAN_PREFIXES.map((p) => ({ name: { startsWith: `${p} – ` } })) },
    select: { name: true },
  });
  return highestPlanVersion(docs.map((d) => d.name));
}

/** Columna con rol «Plan de trabajo para IA» del proyecto (si no, error). */
async function planColumn(projectId: string, columnId: string) {
  const column = await db.column.findFirst({ where: { id: columnId, projectId, role: "AI_PLAN" }, select: { id: true, name: true, planCount: true } });
  if (!column) throw new AppError("Esta columna ya no es un plan de trabajo para IA. Recarga el tablero.", 409);
  return column;
}

const setupSchema = z.object({ projectId: v.id, columnId: v.id });

/**
 * Lo que el diálogo «Generar plan de trabajo» necesita al abrirse: las cabeceras y pies del plan (de la persona y del
 * proyecto), la descripción del proyecto (contexto para la IA), la fecha y la versión que tendrá el plan si se guarda.
 */
export async function getAiPlanSetup(input: z.input<typeof setupSchema>) {
  return runAction({ name: "aiPlan.getAiPlanSetup", args: [input] }, async () => {
    const user = await requireUser();
    const data = setupSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const column = await planColumn(data.projectId, data.columnId);
    const [templates, projectTemplates, project, saved] = await Promise.all([
      userPlanTemplates(user.id),
      projectPlanTemplates(data.projectId),
      db.project.findUniqueOrThrow({ where: { id: data.projectId }, select: { description: true, aiPlanCount: true } }),
      highestSavedVersion(data.projectId),
    ]);
    return {
      templates,
      projectTemplates,
      description: project.description,
      today: todayIso(appTimeZone()),
      nextVersion: Math.max(project.aiPlanCount, saved) + 1,
      // Número de plan de ESTA columna (ritmo de sus tareas fijas): independiente del de las demás columnas de plan.
      nextColumnPlan: column.planCount + 1,
    };
  });
}

// Sin mensaje propio, con más de 500 tareas el diálogo mostraba el de zod en inglés («Too big: expected array…»).
const detailsSchema = z.object({ projectId: v.id, taskIds: z.array(v.id).max(AI_PLAN_MAX_TASKS, "Un plan de trabajo admite como mucho 500 tareas: quita alguna de la selección.") });

/** Descripción, subtareas, adjuntos y documentos vinculados de las tareas del plan (no viajan con el tablero). */
export async function getAiPlanTaskDetails(input: z.input<typeof detailsSchema>) {
  return runAction({ name: "aiPlan.getAiPlanTaskDetails", args: [input] }, async () => {
    const user = await requireUser();
    const data = detailsSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    describeAction(`Generó un plan de trabajo para IA con ${data.taskIds.length === 1 ? "1 tarea" : `${data.taskIds.length} tareas`}`);
    return db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId },
      select: {
        id: true,
        description: true,
        subtasks: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true, done: true } },
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, isImage: true } },
        links: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { title: true, url: true } },
      },
    });
  });
}

const saveSchema = z.object({
  projectId: v.id,
  columnId: v.id,
  content: z.string().trim().min(1, "El contenido está vacío.").max(MAX_RELEASE_CONTENT, "El contenido es demasiado largo."),
});

/**
 * «Guardar en Documentación»: guarda el plan como «Plan de trabajo – AAAA-MM-DD_vN.md», con N la versión siguiente del
 * proyecto (el contador solo crece, y nunca queda por debajo de la versión más alta ya guardada, también tras importar el
 * proyecto). Cada guardado suma además un plan a la columna (Column.planCount): el ritmo de sus tareas fijas cuenta con él,
 * no con la versión del proyecto. Solo se guarda el .md, no el ZIP de adjuntos (ya están en las tareas). Mismos límites que una subida (tamaño por archivo, máximo de documentos, cuotas). Si no se guarda, la
 * versión no se gasta.
 */
export async function saveAiPlan(input: z.input<typeof saveSchema>) {
  return runAction({ name: "aiPlan.saveAiPlan", args: [{ ...input, content: `(${input.content?.length ?? 0} caracteres)` }] }, async () => {
    const user = await requireUser();
    const data = saveSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const column = await planColumn(data.projectId, data.columnId);
    const t = await getT();
    const floor = await highestSavedVersion(data.projectId);
    const [row] = await db.$queryRaw<{ aiPlanCount: number }[]>`
      UPDATE "Project" SET "aiPlanCount" = GREATEST("aiPlanCount", ${floor}) + 1 WHERE "id" = ${data.projectId} RETURNING "aiPlanCount"`;
    if (!row) throw new AppError("No encontrado o sin acceso.", 404);
    const version = row.aiPlanCount;
    // El ritmo de las tareas fijas se cuenta por columna: cada plan guardado suma uno a la suya (y solo a la suya).
    await db.$executeRaw`UPDATE "Column" SET "planCount" = "planCount" + 1 WHERE "id" = ${column.id}`;
    const release = async () => {
      await db.$executeRaw`UPDATE "Project" SET "aiPlanCount" = "aiPlanCount" - 1 WHERE "id" = ${data.projectId} AND "aiPlanCount" = ${version}`;
      await db.$executeRaw`UPDATE "Column" SET "planCount" = GREATEST("planCount" - 1, 0) WHERE "id" = ${column.id}`;
    };
    const name = aiPlanFileName(t(PLAN_PREFIX), todayIso(appTimeZone()), version);
    const content = new TextEncoder().encode(data.content.endsWith("\n") ? data.content : `${data.content}\n`);
    const saved = await saveGeneratedDocument({ projectId: data.projectId, name, content, mimeType: "text/markdown", kind: "MARKDOWN", createdById: user.id })
      .catch(async (err) => {
        await release();
        throw err;
      });
    if (!saved.ok) {
      await release();
      const p = saved.problem;
      if (p.reason === "size") throw new AppError(t("El archivo supera el tamaño máximo del proyecto ({mb} MB por archivo).", { mb: p.maxMb }), 413);
      if (p.reason === "count") throw new AppError(t("La documentación del proyecto ya tiene el máximo de {n} archivos.", { n: p.limit }), 409);
      throw quotaError(t, p.quota, { projectId: data.projectId, isAdmin: user.role === "ADMIN", locale: intlLocale(await getLocale()) });
    }
    describeAction("Guardó en la Documentación el plan de trabajo «{name}» de «{column}»", { name: saved.document.name, column: column.name }, { documentId: saved.document.id, columnId: column.id, version });
    return { id: saved.document.id, name: saved.document.name, version };
  });
}
