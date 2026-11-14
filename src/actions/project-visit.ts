"use server";

import { setAdminProjectPick } from "@/actions/projects";
import { runAction } from "@/lib/action";
import { outsideListProject, type OutsideListProject } from "@/lib/project-visit";
import { getCurrentUser, requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

/**
 * Al abrir con la navegación de la app un proyecto de equipo que el administrador no tiene en su lista (por un enlace,
 * desde Administración → Proyectos o desde un aviso): su nombre, para el selector y la navegación del proyecto. null si
 * está en la lista, no es de equipo, no existe o quien pregunta no es administrador.
 */
export async function projectOutsideList(projectId: string) {
  return runAction(async (): Promise<OutsideListProject | null> => outsideListProject(await requireUser(), v.id.parse(projectId)));
}

/** «Añadir a mis proyectos» desde el selector, para quien lo tiene abierto (lo mismo que en «Proyectos existentes»). */
export async function addProjectToMine(projectId: string) {
  const user = await getCurrentUser().catch(() => null);
  return setAdminProjectPick(projectId, user?.id ?? "-", true);
}
