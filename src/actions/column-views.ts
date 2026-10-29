"use server";

import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import type { ChecklistItem } from "@/lib/checklist";
import { loadChecklistItems, loadPendingSubtasks } from "@/lib/column-views";
import { notFound } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { getLocale } from "@/i18n/server";
import { z } from "zod";

/** Subtareas de todas las tarjetas de una columna «Lista consolidada» (lectura; marcar usa updateSubtask). */
export async function getColumnChecklist(projectId: string, columnId: string) {
  return runAction({ name: "columnViews.getColumnChecklist", args: [projectId, columnId] }, async (): Promise<{ name: string; items: ChecklistItem[] }> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const data = await loadChecklistItems(projectId, v.id.parse(columnId), await getLocale());
    if (!data) throw notFound();
    return { name: data.column.name, items: data.items };
  });
}

/** Subtareas sin marcar de las tarjetas indicadas (aviso al sacarlas de una columna «Revisión con requisitos»). */
export async function getPendingSubtasks(projectId: string, taskIds: string[]) {
  return runAction({ name: "columnViews.getPendingSubtasks", args: [projectId, taskIds] }, async () => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    return loadPendingSubtasks(projectId, z.array(v.id).max(500).parse(taskIds));
  });
}
