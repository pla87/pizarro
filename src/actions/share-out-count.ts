"use server";

import { visibleProjectsWhere } from "@/lib/access";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requireAdmin } from "@/lib/session";
import { countActiveShares } from "@/lib/share-out";
import * as v from "@/lib/validation";

/**
 * Ajustes → «Compartir fuera» (solo administradores): cuántos enlaces del proyecto funcionan ahora, al pulsar para apagarla
 * (el recuento de cuando se cargó la página puede ser viejo: otra pestaña puede haber generado una web entretanto). Solo
 * lee: no cambia nada ni queda en el historial.
 */
export async function countProjectShareLinks(projectId: string) {
  return runAction(async (): Promise<number> => {
    const user = await requireAdmin();
    const id = v.id.parse(projectId);
    const project = await db.project.findFirst({ where: { id, ...visibleProjectsWhere(user) }, select: { id: true } });
    if (!project) throw notFound();
    return countActiveShares(project.id);
  });
}
