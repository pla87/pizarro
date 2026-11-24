import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { hasEvergreenTasks } from "./constants";
import { addDaysIso, isoToDate, todayIso } from "./dates";
import { appTimeZone } from "./format";
import { POSITION_STEP } from "./positions";
import { COLUMN_ORDER } from "./task-positions";
import { GENERAL_KIND_IDS, type ResolvedExamples } from "./project-examples";
import { normalizeRecurrence } from "./recurrence-date";

/**
 * Crea los entregables y las tarjetas de ejemplo de una plantilla de serie en un proyecto recién creado (dentro de su
 * transacción), cuando ya tiene las columnas, tipos y etiquetas de la plantilla. Cada tarjeta va a la columna con el
 * nombre de la columna canónica que indica; si no está (plantilla modificada), a la que tenga su mismo rol y, si no, a la
 * primera. Tipos y etiquetas se buscan por nombre; un tipo que falte se sustituye por el primero disponible para que la
 * tarjeta nunca quede sin tipo.
 */
export async function createExampleContent(tx: Prisma.TransactionClient, projectId: string, example: ResolvedExamples, userId: string): Promise<number> {
  const { content, canonical } = example;
  const today = todayIso(appTimeZone());
  const due = (days: number) => isoToDate(addDaysIso(today, days));

  const [columns, ownKinds, generalKinds, labels] = await Promise.all([
    tx.column.findMany({ where: { projectId }, orderBy: COLUMN_ORDER, select: { id: true, name: true, role: true } }),
    tx.taskKind.findMany({ where: { projectId }, select: { id: true, name: true } }),
    tx.taskKind.findMany({ where: { projectId: null }, orderBy: { position: "asc" }, select: { id: true } }),
    tx.label.findMany({ where: { projectId }, select: { id: true, name: true } }),
  ]);
  const kindByName = new Map(ownKinds.map((k) => [k.name.toLowerCase(), k.id]));
  const labelByName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  const generalIds = new Set(generalKinds.map((k) => k.id));
  const fallbackKind = ownKinds[0]?.id ?? generalKinds[0]?.id;
  const columnFor = (index: number) => {
    const want = canonical.columns[index];
    if (!want) return undefined;
    return columns.find((c) => c.name.trim().toLowerCase() === want.name.trim().toLowerCase())
      ?? (want.role !== "NONE" ? columns.find((c) => c.role === want.role) : undefined)
      ?? columns[0];
  };

  const deliverables: string[] = [];
  for (const [i, d] of (content.deliverables ?? []).entries()) {
    const created = await tx.deliverable.create({
      data: { projectId, name: d.name, description: d.description ?? "", dueDate: due(d.dueInDays), position: (i + 1) * POSITION_STEP },
      select: { id: true },
    });
    deliverables.push(created.id);
  }

  const nextPosition = new Map<string, number>();
  let count = 0;
  for (const t of content.tasks) {
    const column = columnFor(t.column);
    if (!column) continue;
    const generalId = t.generalKind ? GENERAL_KIND_IDS[t.generalKind] : undefined;
    const kindId = (t.kind ? kindByName.get(t.kind.toLowerCase()) : generalId && generalIds.has(generalId) ? generalId : undefined) ?? fallbackKind;
    if (!kindId) continue;
    const position = (nextPosition.get(column.id) ?? 0) + POSITION_STEP;
    nextPosition.set(column.id, position);
    const dueDate = t.dueInDays !== undefined ? addDaysIso(today, t.dueInDays) : null;
    const repeat = t.recurrence ? normalizeRecurrence(t.recurrence, t.recurrenceDay, dueDate, today) : null;
    const labelIds = [example.exampleLabel, ...(t.labels ?? [])].flatMap((name) => labelByName.get(name.toLowerCase()) ?? []);
    await tx.task.create({
      data: {
        projectId,
        columnId: column.id,
        title: t.title,
        description: t.description ?? "",
        kindId,
        position,
        createdById: userId,
        dueDate: dueDate ? isoToDate(dueDate) : null,
        startDate: t.startInDays !== undefined ? due(t.startInDays) : null,
        deliverableId: t.deliverable !== undefined ? deliverables[t.deliverable] : undefined,
        priority: t.priority,
        cost: t.cost,
        estimatedHours: t.estimatedHours,
        client: t.client,
        ...(repeat ?? {}),
        // Fija («Siempre en la release / en el plan») solo en una columna que las admite.
        evergreen: Boolean(t.evergreen && hasEvergreenTasks(column.role)),
        labels: { create: [...new Set(labelIds)].map((labelId) => ({ labelId })) },
        subtasks: { create: (t.subtasks ?? []).map((title, i) => ({ title, position: (i + 1) * POSITION_STEP })) },
      },
      select: { id: true },
    });
    count++;
  }
  return count;
}
