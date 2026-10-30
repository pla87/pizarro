"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { noteProject } from "@/lib/action-context";
import { lockProject } from "@/lib/caps";
import { MAX_RELEASE_TEMPLATES_PER_KIND, MAX_TEMPLATE } from "@/lib/constants";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

const templateSchema = z.object({
  name: v.name.max(60, "Máximo 60 caracteres."),
  content: z.string().max(MAX_TEMPLATE, "La plantilla es demasiado larga."),
});

/**
 * Cabeceras y pies de release del proyecto. Los gestiona cualquiera con acceso al proyecto (miembros y administradores
 * que lo ven); «Generar release» los ofrece tras las plantillas del usuario.
 */
export async function createProjectReleaseTemplate(projectId: string, kind: "HEADER" | "FOOTER", input: { name: string; content: string }) {
  return runAction({ name: "projectReleaseTemplates.create", args: [projectId, kind, input] }, async () => {
    const user = await requireUser();
    const k = z.enum(["HEADER", "FOOTER"]).parse(kind);
    const data = templateSchema.parse(input);
    const pid = v.id.parse(projectId);
    await assertProjectAccess(user, pid);
    const project = { id: pid };
    const created = await db.$transaction(async (tx) => {
      // Con el proyecto bloqueado, dos altas a la vez no pueden pasarse del tope.
      await lockProject(tx, project.id);
      if ((await tx.projectReleaseTemplate.count({ where: { projectId: project.id, kind: k } })) >= MAX_RELEASE_TEMPLATES_PER_KIND) {
        throw new AppError("Máximo 20 plantillas de este tipo en el proyecto.");
      }
      const last = await tx.projectReleaseTemplate.findFirst({ where: { projectId: project.id, kind: k }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.projectReleaseTemplate.create({
        data: { projectId: project.id, kind: k, ...data, position: (last?.position ?? 0) + POSITION_STEP },
        select: { id: true, name: true, content: true },
      });
    });
    revalidatePath(`/p/${project.id}`, "layout");
    return created;
  });
}

async function accessibleTemplate(templateId: string) {
  const user = await requireUser();
  const t = await db.projectReleaseTemplate.findUnique({ where: { id: v.id.parse(templateId) }, select: { id: true, projectId: true, kind: true } });
  if (!t) throw notFound();
  // assertProjectAccess responde «no encontrado» si el proyecto no es visible para el usuario.
  await assertProjectAccess(user, t.projectId);
  noteProject(t.projectId);
  return t;
}

export async function updateProjectReleaseTemplate(templateId: string, input: { name: string; content: string }) {
  return runAction({ name: "projectReleaseTemplates.update", args: [templateId, input] }, async () => {
    const data = templateSchema.parse(input);
    const t = await accessibleTemplate(templateId);
    await db.projectReleaseTemplate.update({ where: { id: t.id }, data });
    revalidatePath(`/p/${t.projectId}`, "layout");
  });
}

/** Sube (-1) o baja (+1) una plantilla dentro de su tipo; ese orden es el que ve el equipo en «Generar release». */
export async function moveProjectReleaseTemplate(templateId: string, direction: number) {
  return runAction({ name: "projectReleaseTemplates.move", args: [templateId, direction] }, async () => {
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const t = await accessibleTemplate(templateId);
    const list = await db.projectReleaseTemplate.findMany({
      where: { projectId: t.projectId, kind: t.kind },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const idx = list.findIndex((x) => x.id === t.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target]!, list[idx]!];
    // Se renumera la lista entera: el orden queda fijo aunque hubiera posiciones repetidas.
    await db.$transaction(list.map((x, i) => db.projectReleaseTemplate.update({ where: { id: x.id }, data: { position: (i + 1) * POSITION_STEP } })));
    revalidatePath(`/p/${t.projectId}`, "layout");
  });
}

export async function deleteProjectReleaseTemplate(templateId: string) {
  return runAction({ name: "projectReleaseTemplates.delete", args: [templateId] }, async () => {
    const t = await accessibleTemplate(templateId);
    await db.projectReleaseTemplate.delete({ where: { id: t.id } });
    revalidatePath(`/p/${t.projectId}`, "layout");
  });
}
