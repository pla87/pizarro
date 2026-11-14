import "server-only";
// «Aplicar plantilla» a un proyecto que ya existe: se ejecuta el plan de template-apply-core.ts en una sola transacción
// (o todo o nada) y se guarda antes una instantánea de lo que había (ProjectTemplateChange, una por proyecto) para poder
// deshacerlo durante TEMPLATE_UNDO_HOURS. El deshacer normal (lib/undo.ts) no encaja: sus operaciones son de tareas y
// columnas, se aplican una a una (no en bloque) y no cubren tipos, etiquetas, tipos ocultos ni campos; por eso el cambio
// de plantilla tiene su propio «Deshacer el cambio de plantilla» en los ajustes, también de una sola transacción.
//
// Reglas que se cumplen siempre: nada que tenga tareas se borra (columnas, tipos y etiquetas se comprueban otra vez dentro
// de la transacción, ya bloqueados), las tareas no se pierden ni se crean, y los roles únicos no se repiten.
import type { Prisma } from "@/generated/prisma/client";
import { columnsLockName } from "./advisory-locks";
import { lockProject } from "./caps";
import { assertProgramColumnsFit } from "./column-capacity";
import { UNIQUE_COLUMN_ROLES } from "./constants";
import { db } from "./db";
import { AppError } from "./errors";
import { lockKindScope } from "./kind-lock";
import { localizeGeneralKind } from "./kinds-localize";
import { POSITION_STEP } from "./positions";
import { normalizeTaskFields } from "./task-fields";
import { lastPositionIn, lockColumns, lockTaskRows, setTaskColumnPositions } from "./task-positions";
import {
  planAdd, planReplace, TEMPLATE_UNDO_HOURS,
  type AddPlan, type ApplyChoices, type ApplyMode, type ApplyTemplateShape, type ProjectShape, type ReplacePlan,
} from "./template-apply-core";
import type { Locale } from "@/i18n/shared";
import { getT } from "@/i18n/server";
import type { ColumnRole } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

interface ColumnSnap { id: string; name: string; position: number; role: string; isDone: boolean; waitingDays: number | null; routineTargetColumnId: string | null; wipLimit: number | null }
interface KindSnap { id: string; name: string; color: string; position: number; titleTemplate: string; descriptionTemplate: string; subtaskTemplate: string[]; createdAt: string }
/** Tarea que el cambio tocó: lo que tenía (columna, posición, tipo, fija) y adónde fue (null = no cambió eso). */
interface TaskSnap { id: string; c: string; p: number; k: string; e: boolean; ee: number; tc: string | null; tk: string | null }

/** Lo que había antes del cambio y lo que creó (lo necesario para deshacerlo). */
interface TemplateChangeSnapshot {
  v: 1;
  columns: ColumnSnap[];
  createdColumns: string[];
  kinds: KindSnap[];
  createdKinds: string[];
  hidden: string[];
  labels: { id: string; name: string; color: string }[];
  createdLabels: string[];
  createdReleaseTemplates: string[];
  taskFields: string[];
  tasks: TaskSnap[];
}

/** Candados del cambio de plantilla y de su deshacer: columnas, tipos y la fila del proyecto (etiquetas), en este orden. */
async function lockStructure(tx: Tx, projectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(projectId)}))`;
  await lockKindScope(tx, projectId);
  await lockProject(tx, projectId);
}

/** Estado actual del proyecto para el asistente (y para volver a planificar dentro de la transacción). */
export async function loadProjectShape(client: Client, projectId: string, locale: Locale): Promise<ProjectShape> {
  const project = await client.project.findUniqueOrThrow({ where: { id: projectId }, select: { taskFields: true } });
  const columns = await client.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, role: true, isDone: true, wipLimit: true } });
  const columnCounts = await client.$queryRaw<{ columnId: string; active: number; archived: number }[]>`
    SELECT "columnId", count(*) FILTER (WHERE "archivedAt" IS NULL)::int AS active, count(*) FILTER (WHERE "archivedAt" IS NOT NULL)::int AS archived
    FROM "Task" WHERE "projectId" = ${projectId} GROUP BY "columnId"`;
  const kinds = await client.taskKind.findMany({
    where: { OR: [{ projectId: null }, { projectId }] },
    orderBy: [{ projectId: { sort: "asc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, projectId: true },
  });
  const hidden = new Set((await client.projectHiddenKind.findMany({ where: { projectId }, select: { kindId: true } })).map((h) => h.kindId));
  const kindCounts = await client.$queryRaw<{ kindId: string; n: number }[]>`SELECT "kindId", count(*)::int AS n FROM "Task" WHERE "projectId" = ${projectId} GROUP BY "kindId"`;
  const labels = await client.label.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const labelCounts = await client.$queryRaw<{ labelId: string; n: number }[]>`
    SELECT tl."labelId", count(*)::int AS n FROM "TaskLabel" tl JOIN "Label" l ON l."id" = tl."labelId" WHERE l."projectId" = ${projectId} GROUP BY tl."labelId"`;
  const releaseTemplates = await client.projectReleaseTemplate.findMany({ where: { projectId }, select: { kind: true, name: true } });
  // Tareas fijas (pocas: solo caben en la columna de release), para que el resumen diga cuáles pasan a normales.
  const evergreen = await client.task.findMany({ where: { projectId, evergreen: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, title: true, columnId: true } });
  const byColumn = new Map(columnCounts.map((c) => [c.columnId, c]));
  const byKind = new Map(kindCounts.map((k) => [k.kindId, k.n]));
  const byLabel = new Map(labelCounts.map((l) => [l.labelId, l.n]));
  return {
    columns: columns.map((c) => ({ ...c, active: byColumn.get(c.id)?.active ?? 0, archived: byColumn.get(c.id)?.archived ?? 0 })),
    kinds: kinds.map((k) => ({
      id: k.id, name: k.name, label: k.projectId === null ? localizeGeneralKind(k, locale).name : k.name,
      general: k.projectId === null, hidden: hidden.has(k.id), tasks: byKind.get(k.id) ?? 0,
    })),
    labels: labels.map((l) => ({ ...l, tasks: byLabel.get(l.id) ?? 0 })),
    releaseTemplates,
    taskFields: normalizeTaskFields(project.taskFields),
    evergreen,
  };
}

/** Instantánea de lo que hay ahora (antes de tocar nada). */
async function takeSnapshot(tx: Tx, projectId: string): Promise<TemplateChangeSnapshot> {
  const columns = await tx.column.findMany({ where: { projectId }, select: { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true } });
  const kinds = await tx.taskKind.findMany({ where: { projectId }, select: { id: true, name: true, color: true, position: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true, createdAt: true } });
  const hidden = await tx.projectHiddenKind.findMany({ where: { projectId }, select: { kindId: true } });
  const labels = await tx.label.findMany({ where: { projectId }, select: { id: true, name: true, color: true } });
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { taskFields: true } });
  return {
    v: 1,
    columns,
    createdColumns: [],
    kinds: kinds.map((k) => ({ ...k, createdAt: k.createdAt.toISOString() })),
    createdKinds: [],
    hidden: hidden.map((h) => h.kindId),
    labels,
    createdLabels: [],
    createdReleaseTemplates: [],
    taskFields: project.taskFields,
    tasks: [],
  };
}

/** Lo que se hizo, para el registro y el aviso. */
interface ApplyResult {
  mode: ApplyMode;
  movedTasks: number;
  retypedTasks: number;
  addedColumns: number;
  removedColumns: number;
  addedKinds: number;
  addedLabels: number;
  /** Tipos generales que vuelven a verse y tareas fijas que pasan a normales. */
  shownGenerals: number;
  unpinnedTasks: number;
}

/**
 * Aplica la plantilla al proyecto en una transacción, con la instantánea para deshacer. El plan se vuelve a calcular aquí,
 * con los datos ya bloqueados: lo que el asistente enseñó puede haber cambiado (otra persona movió tareas o creó columnas).
 */
export async function applyTemplateToProject(opts: {
  projectId: string; userId: string; locale: Locale; templateName: string; template: ApplyTemplateShape; mode: ApplyMode; choices?: Partial<ApplyChoices>;
}): Promise<ApplyResult> {
  const { projectId, template, mode } = opts;
  return db.$transaction(async (tx) => {
    await lockStructure(tx, projectId);
    const shape = await loadProjectShape(tx, projectId, opts.locale);
    const plan = mode === "ADD" ? planAdd(shape, template) : planReplace(shape, template, opts.choices);
    if (plan.errors.length) {
      const e = plan.errors[0]!;
      throw new AppError((await getT())(e.text, e.vars));
    }
    const snap = await takeSnapshot(tx, projectId);
    const result = plan.mode === "ADD" ? await executeAdd(tx, projectId, plan, template, snap) : await executeReplace(tx, projectId, plan, template, shape, snap);
    await addCommon(tx, projectId, plan, snap);
    // Ninguna columna «Programa del curso» por encima del tope de sesiones (por el rol nuevo o por las tareas unidas).
    await assertProgramColumnsFit(tx, projectId, shape.columns);
    const data = { userId: opts.userId, templateName: opts.templateName.slice(0, 200), mode, snapshot: snap as unknown as Prisma.InputJsonValue, createdAt: new Date() };
    await tx.projectTemplateChange.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    return { ...result, addedLabels: plan.addLabels.length };
  }, { timeout: 120_000, maxWait: 15_000 });
}

/** Etiquetas, plantillas de release y campos: igual en los dos modos (en REPLACE, además, se quitan las etiquetas sin uso). */
async function addCommon(tx: Tx, projectId: string, plan: AddPlan | ReplacePlan, snap: TemplateChangeSnapshot): Promise<void> {
  if (plan.mode === "REPLACE" && plan.removeLabels.length) {
    // Solo las que siguen sin tareas (ya con la fila del proyecto bloqueada: nadie crea etiquetas a la vez).
    await tx.label.deleteMany({ where: { id: { in: plan.removeLabels }, projectId, tasks: { none: {} } } });
  }
  if (plan.addLabels.length) {
    const created = await tx.label.createManyAndReturn({ data: plan.addLabels.map((l) => ({ projectId, name: l.name, color: l.color })), skipDuplicates: true, select: { id: true } });
    snap.createdLabels = created.map((l) => l.id);
  }
  for (const kind of ["HEADER", "FOOTER"] as const) {
    const list = plan.addReleaseTemplates.filter((r) => r.kind === kind);
    if (!list.length) continue;
    const last = await tx.projectReleaseTemplate.findFirst({ where: { projectId, kind }, orderBy: { position: "desc" }, select: { position: true } });
    const base = last?.position ?? 0;
    const created = await tx.projectReleaseTemplate.createManyAndReturn({
      data: list.map((r, i) => ({ projectId, kind, name: r.name, content: r.content, position: base + (i + 1) * POSITION_STEP })),
      select: { id: true },
    });
    snap.createdReleaseTemplates.push(...created.map((r) => r.id));
  }
  if (plan.addedFields.length) await tx.project.update({ where: { id: projectId }, data: { taskFields: plan.taskFields } });
}

async function executeAdd(tx: Tx, projectId: string, plan: AddPlan, template: ApplyTemplateShape, snap: TemplateChangeSnapshot): Promise<Omit<ApplyResult, "addedLabels">> {
  if (plan.addColumns.length) {
    const last = await tx.column.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
    const base = last?.position ?? 0;
    const created = await tx.column.createManyAndReturn({
      data: plan.addColumns.map((c, i) => ({ projectId, name: c.name, role: c.role as ColumnRole, isDone: c.isDone, wipLimit: c.wipLimit, position: base + (i + 1) * POSITION_STEP })),
      select: { id: true },
    });
    snap.createdColumns = created.map((c) => c.id);
  }
  if (plan.addKinds.length) {
    const last = await tx.taskKind.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
    const base = last?.position ?? 0;
    const created = await tx.taskKind.createManyAndReturn({
      data: plan.addKinds.map((i, n) => {
        const k = template.kinds[i]!;
        return { projectId, name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate, position: base + (n + 1) * POSITION_STEP };
      }),
      select: { id: true },
    });
    snap.createdKinds = created.map((k) => k.id);
  }
  // Los generales que usa la plantilla vuelven a verse (la instantánea guarda los ocultos: el deshacer los vuelve a ocultar).
  if (plan.showGenerals.length) await tx.projectHiddenKind.deleteMany({ where: { projectId, kindId: { in: plan.showGenerals } } });
  return { mode: "ADD", movedTasks: 0, retypedTasks: 0, addedColumns: plan.addColumns.length, removedColumns: 0, addedKinds: plan.addKinds.length, shownGenerals: plan.showGenerals.length, unpinnedTasks: 0 };
}

async function executeReplace(tx: Tx, projectId: string, plan: ReplacePlan, template: ApplyTemplateShape, shape: ProjectShape, snap: TemplateChangeSnapshot): Promise<Omit<ApplyResult, "addedLabels">> {
  const now = new Date();
  const tasks = new Map<string, TaskSnap>();
  const note = (rows: { id: string; columnId: string; position: number; kindId: string; evergreen: boolean; evergreenEvery: number }[]) => {
    for (const r of rows) if (!tasks.has(r.id)) tasks.set(r.id, { id: r.id, c: r.columnId, p: r.position, k: r.kindId, e: r.evergreen, ee: r.evergreenEvery, tc: null, tk: null });
  };
  const taskSelect = { id: true, columnId: true, position: true, kindId: true, evergreen: true, evergreenEvery: true } as const;
  const original = new Map(snap.columns.map((c) => [c.id, c]));

  // --- Columnas ------------------------------------------------------------------------------------------------------
  // Los roles únicos se quitan primero y se ponen al final: así ningún paso intermedio repite uno (índice único parcial).
  await tx.column.updateMany({ where: { projectId, role: { in: UNIQUE_COLUMN_ROLES as ColumnRole[] } }, data: { role: "NONE" } });
  const targetId: string[] = [];
  const created: string[] = [];
  for (const c of plan.columns) {
    if (c.reuse) targetId.push(c.reuse);
    else {
      const row = await tx.column.create({ data: { projectId, name: c.name, role: "NONE", isDone: c.isDone, wipLimit: c.wipLimit, position: (c.index + 1) * POSITION_STEP }, select: { id: true } });
      targetId.push(row.id);
      created.push(row.id);
    }
  }
  snap.createdColumns = created;
  // Nombre, rol, orden y límite de cada columna final (antes de mover tareas: así los disparadores de la base de datos ven
  // ya el rol de su columna nueva); las conservadas, después y en su orden.
  const finals: { id: string; name?: string; isDone?: boolean; wipLimit?: number | null; role: string; position: number }[] = [
    ...plan.columns.map((c, i) => ({ id: targetId[i]!, name: c.name, isDone: c.isDone, ...(c.wipLimit !== null || !c.reuse ? { wipLimit: c.wipLimit } : {}), role: c.role, position: (i + 1) * POSITION_STEP })),
    ...plan.kept.map((k, i) => ({ id: k.id, role: k.role, position: (plan.columns.length + i + 1) * POSITION_STEP })),
  ];
  for (const f of finals) {
    const before = original.get(f.id);
    const leaves = (role: string) => before?.role === role && f.role !== role;
    await tx.column.update({
      where: { id: f.id },
      data: {
        ...(f.name !== undefined ? { name: f.name } : {}),
        ...(f.isDone !== undefined ? { isDone: f.isDone } : {}),
        ...(f.wipLimit !== undefined ? { wipLimit: f.wipLimit } : {}),
        role: f.role as ColumnRole,
        position: f.position,
        // Lo mismo que al cambiar el rol a mano (setColumnRole): el plazo de espera y el destino de rutinas son de su rol.
        ...(leaves("WAITING") ? { waitingDays: null } : {}),
        ...(leaves("ROUTINES") ? { routineTargetColumnId: null } : {}),
      },
    });
    // Una columna que pasa a «Esperando» cuenta la espera desde ahora (sin avisos de golpe por las tareas antiguas).
    if (f.role === "WAITING" && before?.role !== "WAITING") await tx.task.updateMany({ where: { columnId: f.id, archivedAt: null }, data: { columnEnteredAt: now, waitingNotifiedAt: null } });
  }
  // Tareas de las columnas que se unen a otra (archivadas incluidas): al final de la de destino, en su orden.
  let movedTasks = 0;
  const order = new Map(shape.columns.map((c, i) => [c.id, i]));
  for (const [i, c] of plan.columns.entries()) {
    if (!c.absorb.length) continue;
    const target = targetId[i]!;
    await lockColumns(tx, [target, ...c.absorb]);
    const rows = await tx.task.findMany({ where: { projectId, columnId: { in: c.absorb } }, select: taskSelect });
    if (!rows.length) continue;
    rows.sort((a, b) => order.get(a.columnId)! - order.get(b.columnId)! || a.position - b.position || (a.id < b.id ? -1 : 1));
    await lockTaskRows(tx, rows.map((r) => r.id));
    note(rows);
    let pos = (await lastPositionIn(tx, target)) ?? 0;
    const moves = rows.map((r) => ({ id: r.id, position: (pos += POSITION_STEP) }));
    await setTaskColumnPositions(moves, target, { client: tx });
    // Las archivadas recuerdan de qué columna salieron (adónde vuelven al recuperarlas y qué dice «Archivadas»): la que
    // se quita ya no existe, así que pasan a ser de la columna a la que se ha unido (si no, volverían a la primera).
    await tx.task.updateMany({ where: { id: { in: rows.map((r) => r.id) }, archivedAt: { not: null }, archivedFromColumnId: { in: c.absorb } }, data: { archivedFromColumnId: target } });
    for (const r of rows) tasks.get(r.id)!.tc = target;
    movedTasks += c.incoming;
  }
  // Columnas que se quitan: solo si de verdad están vacías (nunca se borra nada con tareas).
  const remove = [...plan.columns.flatMap((c) => c.absorb), ...plan.dropColumns];
  if (remove.length) {
    if (await tx.task.count({ where: { columnId: { in: remove } } })) throw new AppError("Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo.");
    await tx.column.deleteMany({ where: { id: { in: remove }, projectId } });
  }
  // Las tareas fijas solo existen en la columna de release: las que se quedan fuera pasan a normales.
  const stray = await tx.task.findMany({ where: { projectId, evergreen: true, column: { role: { not: "NEXT_RELEASE" } } }, select: taskSelect });
  if (stray.length) {
    note(stray);
    await tx.task.updateMany({ where: { id: { in: stray.map((t) => t.id) } }, data: { evergreen: false, evergreenEvery: 1 } });
  }

  // --- Tipos ---------------------------------------------------------------------------------------------------------
  const newKind = new Map<number, string>();
  for (const [i, t] of plan.kindTargets.entries()) {
    if (!("create" in t)) continue;
    const k = template.kinds[i]!;
    const row = await tx.taskKind.create({
      data: { projectId, name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate, position: (i + 1) * POSITION_STEP },
      select: { id: true },
    });
    newKind.set(i, row.id);
  }
  snap.createdKinds = [...newKind.values()];
  if (plan.showGenerals.length) await tx.projectHiddenKind.deleteMany({ where: { projectId, kindId: { in: plan.showGenerals } } });
  let retypedTasks = 0;
  for (const m of plan.kindMoves) {
    const to = m.to ?? newKind.get(m.toNew!)!;
    const rows = await tx.task.findMany({ where: { projectId, kindId: m.from }, select: taskSelect });
    if (!rows.length) continue;
    await lockTaskRows(tx, rows.map((r) => r.id));
    note(rows);
    await tx.task.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { kindId: to, updatedAt: now } });
    for (const r of rows) tasks.get(r.id)!.tk = to;
    retypedTasks += rows.length;
  }
  // Tipos propios que se quitan: solo los que ya no tiene ninguna tarea.
  if (plan.dropKinds.length) await tx.taskKind.deleteMany({ where: { id: { in: plan.dropKinds }, projectId, tasks: { none: {} } } });
  // Orden: los de la plantilla primero (en su orden) y después los demás propios, en el suyo.
  const templateIds = plan.kindTargets.map((t, i) => ("create" in t ? newKind.get(i)! : t.existing));
  const own = await tx.taskKind.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, position: true } });
  const ownIds = new Set(own.map((k) => k.id));
  const kindOrder = [...templateIds.filter((id) => ownIds.has(id)), ...own.map((k) => k.id).filter((id) => !templateIds.includes(id))];
  for (const [i, id] of [...new Set(kindOrder)].entries()) {
    const position = (i + 1) * POSITION_STEP;
    if (own.find((k) => k.id === id)!.position !== position) await tx.taskKind.update({ where: { id }, data: { position } });
  }
  // Generales que se ocultan: solo si el proyecto no tiene ninguna tarea de ese tipo.
  for (const kindId of plan.hideGenerals) {
    if (await tx.task.count({ where: { projectId, kindId } })) continue;
    await tx.projectHiddenKind.upsert({ where: { projectId_kindId: { projectId, kindId } }, create: { projectId, kindId }, update: {} });
  }
  await ensureUsableKind(tx, projectId);

  snap.tasks = [...tasks.values()];
  return {
    mode: "REPLACE", movedTasks, retypedTasks,
    addedColumns: created.length,
    removedColumns: remove.length,
    addedKinds: newKind.size,
    shownGenerals: plan.showGenerals.length,
    unpinnedTasks: stray.length,
  };
}

/** Siempre debe quedar algún tipo con el que crear tareas: si no, vuelve a verse el primer general. */
async function ensureUsableKind(tx: Tx, projectId: string): Promise<void> {
  const usable = await tx.taskKind.count({ where: { OR: [{ projectId }, { projectId: null, hiddenIn: { none: { projectId } } }] } });
  if (usable) return;
  const first = await tx.taskKind.findFirst({ where: { projectId: null }, orderBy: { position: "asc" }, select: { id: true } });
  if (first) await tx.projectHiddenKind.deleteMany({ where: { projectId, kindId: first.id } });
}

/** Último cambio de plantilla que aún se puede deshacer (o null). */
export async function undoableTemplateChange(projectId: string, now = new Date()) {
  const row = await db.projectTemplateChange.findUnique({
    where: { projectId },
    select: { id: true, templateName: true, mode: true, createdAt: true, user: { select: { name: true } } },
  });
  if (!row || row.createdAt.getTime() < now.getTime() - TEMPLATE_UNDO_HOURS * 3_600_000) return null;
  return { id: row.id, templateName: row.templateName, mode: row.mode as ApplyMode, createdAt: row.createdAt, userName: row.user?.name ?? null };
}

/** Lo que el deshacer tuvo que dejar porque ya tenía tareas (se avisa a quien deshace). */
interface UndoResult {
  templateName: string;
  keptColumns: number;
  keptKinds: number;
}

/**
 * Deshace el último cambio de plantilla: vuelven las columnas, tipos y etiquetas que quitó (con sus ids), las tareas que
 * movió vuelven a su columna, posición y tipo (solo si nadie las ha cambiado después), y se quita lo que creó, salvo lo
 * que entretanto haya recibido tareas. Todo en una transacción.
 */
export async function undoTemplateChange(projectId: string, now = new Date()): Promise<UndoResult> {
  return db.$transaction(async (tx) => {
    await lockStructure(tx, projectId);
    const row = await tx.projectTemplateChange.findUnique({ where: { projectId } });
    if (!row) throw new AppError("No hay ningún cambio de plantilla que deshacer.");
    if (row.createdAt.getTime() < now.getTime() - TEMPLATE_UNDO_HOURS * 3_600_000) {
      throw new AppError((await getT())("Ya no se puede deshacer: han pasado más de {h} horas.", { h: TEMPLATE_UNDO_HOURS }));
    }
    const snap = row.snapshot as unknown as TemplateChangeSnapshot;

    // 1. Columnas: se apartan los roles únicos, vuelven las que se quitaron (con su id) y todas las de antes recuperan lo suyo.
    const before = await tx.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, role: true } });
    await tx.column.updateMany({ where: { projectId, role: { in: UNIQUE_COLUMN_ROLES as ColumnRole[] } }, data: { role: "NONE" } });
    const present = new Set(before.map((c) => c.id));
    const missingCols = snap.columns.filter((c) => !present.has(c.id));
    if (missingCols.length) {
      await tx.column.createMany({ data: missingCols.map((c) => ({ id: c.id, projectId, name: c.name, position: c.position, role: "NONE" as const, isDone: c.isDone, waitingDays: c.waitingDays, wipLimit: c.wipLimit })) });
    }
    // Las de antes, como estaban (nombre, orden, rol, límites), antes de devolverles sus tareas: así los disparadores de la
    // base de datos ven ya su rol. Las creadas por el cambio no tienen ya ningún rol único (se apartaron arriba).
    const allIds = new Set([...present, ...missingCols.map((c) => c.id)]);
    for (const c of snap.columns) {
      await tx.column.update({
        where: { id: c.id },
        data: {
          name: c.name, position: c.position, role: c.role as ColumnRole, isDone: c.isDone, wipLimit: c.wipLimit, waitingDays: c.waitingDays,
          routineTargetColumnId: c.routineTargetColumnId && allIds.has(c.routineTargetColumnId) ? c.routineTargetColumnId : null,
        },
      });
    }
    // 2. Tipos propios quitados (si nadie ha creado otro con el mismo nombre) y etiquetas quitadas.
    const kindsNow = await tx.taskKind.findMany({ where: { OR: [{ projectId }, { projectId: null }] }, select: { id: true, name: true } });
    const kindIds = new Set(kindsNow.map((k) => k.id));
    const kindNames = new Set(kindsNow.filter((k) => !snap.createdKinds.includes(k.id)).map((k) => k.name.toLowerCase()));
    for (const k of snap.kinds) {
      if (kindIds.has(k.id) || kindNames.has(k.name.toLowerCase())) continue;
      await tx.taskKind.create({ data: { id: k.id, projectId, name: k.name, color: k.color, position: k.position, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate, createdAt: new Date(k.createdAt) } });
      kindIds.add(k.id);
    }
    const labelsNow = await tx.label.findMany({ where: { projectId }, select: { id: true, name: true } });
    const labelIds = new Set(labelsNow.map((l) => l.id));
    const labelNames = new Set(labelsNow.filter((l) => !snap.createdLabels.includes(l.id)).map((l) => l.name.toLowerCase()));
    const missingLabels = snap.labels.filter((l) => !labelIds.has(l.id) && !labelNames.has(l.name.toLowerCase()));
    if (missingLabels.length) await tx.label.createMany({ data: missingLabels.map((l) => ({ ...l, projectId })), skipDuplicates: true });

    // 3. Tareas: vuelven a su columna, posición, tipo y marca de fija, solo si siguen donde las dejó el cambio.
    if (snap.tasks.length) {
      const current = await tx.task.findMany({ where: { id: { in: snap.tasks.map((t) => t.id) }, projectId }, select: { id: true, columnId: true, kindId: true, evergreen: true } });
      const byId = new Map(current.map((t) => [t.id, t]));
      const upd: { id: string; col: string | null; pos: number | null; kind: string | null; ev: boolean | null; eve: number | null }[] = [];
      for (const s of snap.tasks) {
        const cur = byId.get(s.id);
        if (!cur) continue;
        const col = s.tc && cur.columnId === s.tc && allIds.has(s.c) ? s.c : null;
        const kind = s.tk && cur.kindId === s.tk && kindIds.has(s.k) ? s.k : null;
        const ev = s.e && !cur.evergreen ? true : null;
        if (col || kind || ev) upd.push({ id: s.id, col, pos: col ? s.p : null, kind, ev, eve: ev ? s.ee : null });
      }
      if (upd.length) {
        await lockColumns(tx, [...new Set(upd.flatMap((u) => (u.col ? [u.col] : [])))]);
        await lockTaskRows(tx, upd.map((u) => u.id));
        // Una archivada que el cambio pasó a otra columna recordaba esa como origen (executeReplace): vuelve a recordar la
        // suya. En el SET, t."columnId" es el valor de antes de esta orden.
        await tx.$executeRaw`
          UPDATE "Task" AS t SET
            "columnId" = COALESCE(m."col", t."columnId"), "position" = COALESCE(m."pos", t."position"),
            "kindId" = COALESCE(m."kind", t."kindId"), "evergreen" = COALESCE(m."ev", t."evergreen"),
            "archivedFromColumnId" = CASE WHEN m."col" IS NOT NULL AND t."archivedFromColumnId" = t."columnId" THEN m."col" ELSE t."archivedFromColumnId" END,
            "evergreenEvery" = COALESCE(m."eve", t."evergreenEvery"), "updatedAt" = ${now}
          FROM unnest(${upd.map((u) => u.id)}::text[], ${upd.map((u) => u.col)}::text[], ${upd.map((u) => u.pos)}::float8[],
                      ${upd.map((u) => u.kind)}::text[], ${upd.map((u) => u.ev)}::boolean[], ${upd.map((u) => u.eve)}::int4[])
            AS m("id", "col", "pos", "kind", "ev", "eve")
          WHERE t."id" = m."id" AND t."projectId" = ${projectId}`;
      }
    }

    // 4. Lo que creó el cambio, si sigue sin tareas; lo que ya tiene alguna se queda.
    if (snap.createdColumns.length) await tx.column.deleteMany({ where: { id: { in: snap.createdColumns }, projectId, tasks: { none: {} } } });
    const keptColumns = await tx.column.count({ where: { id: { in: snap.createdColumns }, projectId } });
    if (snap.createdKinds.length) await tx.taskKind.deleteMany({ where: { id: { in: snap.createdKinds }, projectId, tasks: { none: {} } } });
    const keptKinds = await tx.taskKind.count({ where: { id: { in: snap.createdKinds }, projectId } });
    if (snap.createdLabels.length) await tx.label.deleteMany({ where: { id: { in: snap.createdLabels }, projectId, tasks: { none: {} } } });
    if (snap.createdReleaseTemplates.length) await tx.projectReleaseTemplate.deleteMany({ where: { id: { in: snap.createdReleaseTemplates }, projectId } });

    // 5. Las columnas que quedan de después (con tareas nuevas), al final y sin repetir un rol único de las de antes.
    const after = await tx.column.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
    const snapIds = new Set(snap.columns.map((c) => c.id));
    const snapRoles = new Set(snap.columns.map((c) => c.role));
    const roleBefore = new Map(before.map((c) => [c.id, c.role]));
    let pos = Math.max(0, ...snap.columns.map((c) => c.position));
    for (const c of after.filter((x) => !snapIds.has(x.id))) {
      const role = roleBefore.get(c.id) ?? "NONE";
      const clash = (UNIQUE_COLUMN_ROLES as readonly string[]).includes(role) && snapRoles.has(role);
      await tx.column.update({ where: { id: c.id }, data: { position: (pos += POSITION_STEP), role: clash ? "NONE" : role } });
    }

    // 6. Orden de los tipos propios, tipos generales ocultos y campos.
    const ownNow = new Set((await tx.taskKind.findMany({ where: { projectId }, select: { id: true } })).map((k) => k.id));
    for (const k of snap.kinds) if (ownNow.has(k.id)) await tx.taskKind.update({ where: { id: k.id }, data: { position: k.position } });
    const hiddenNow = new Set((await tx.projectHiddenKind.findMany({ where: { projectId }, select: { kindId: true } })).map((h) => h.kindId));
    const hiddenWant = new Set(snap.hidden);
    const unhide = [...hiddenNow].filter((id) => !hiddenWant.has(id));
    if (unhide.length) await tx.projectHiddenKind.deleteMany({ where: { projectId, kindId: { in: unhide } } });
    for (const kindId of hiddenWant) {
      if (hiddenNow.has(kindId) || !kindIds.has(kindId) || (await tx.task.count({ where: { projectId, kindId } }))) continue;
      await tx.projectHiddenKind.create({ data: { projectId, kindId } });
    }
    await ensureUsableKind(tx, projectId);
    const budget = await tx.column.count({ where: { projectId, role: "BUDGET" } });
    await tx.project.update({ where: { id: projectId }, data: { taskFields: normalizeTaskFields([...snap.taskFields, ...(budget ? ["cost"] : [])]) } });
    // Las tareas fijas fuera de la columna de release pasan a normales (la marca devuelta solo vale allí).
    await tx.task.updateMany({ where: { projectId, evergreen: true, column: { role: { not: "NEXT_RELEASE" } } }, data: { evergreen: false, evergreenEvery: 1 } });

    await tx.projectTemplateChange.delete({ where: { id: row.id } });
    return { templateName: row.templateName, keptColumns, keptKinds };
  }, { timeout: 120_000, maxWait: 15_000 });
}
