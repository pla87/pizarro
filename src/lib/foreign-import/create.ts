import "server-only";
import { readFile, stat } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import type { T } from "@/i18n/core";
import { toLocale } from "@/i18n/core";
import { PALETTE, defaultColumns } from "../constants";
import { db } from "../db";
import { AppError, forbidden } from "../errors";
import { appTimeZone } from "../format";
import { isoToDate } from "../dates";
import { POSITION_STEP } from "../positions";
import { freeProjectName, insertChunks, newId, type ImportProgress, type ImportSummary, type ImportUser } from "../project-export/import";
import { normalizeTaskFields } from "../task-fields";
import { assertBoardLimits, decodeText, foreignMaxBytes, parseForeign } from "./parse";
import { cleanName, clip, isDoneName } from "./text";
import { FOREIGN_LIMITS, type ForeignBoard, type ForeignFormat, type ForeignPerson } from "./types";

interface ForeignImportOptions {
  isPrivate: boolean;
  t: T;
  /** Nombre del archivo sin extensión (nombre del proyecto si el archivo no trae uno). */
  fileName?: string;
  onProgress?: (p: ImportProgress) => void;
}

/** Colores para etiquetas que vienen sin color (CSV): se reparten por orden de aparición, sin el blanco ni el gris. */
const AUTO_COLORS = PALETTE.filter((c) => c !== "#ffffff" && c !== "#64748b");

/** Persona del archivo con el nombre limpio (80 como mucho) y un email sin espacios ni caracteres de control (si no, se descarta). */
function cleanPerson(p: ForeignPerson): ForeignPerson {
  const email = p.email?.trim().toLowerCase() ?? "";
  return { email: email && email.length <= 254 && !/[\s\u0000-\u001f\u007f]/.test(email) ? email : null, name: p.name ? cleanName(p.name, 80) || null : null };
}

/** Lee y crea el proyecto de un archivo JSON (Trello) o CSV ya guardado en disco. Solo administradores, como la importación de Pizarro. */
export async function importForeignFile(file: string, format: ForeignFormat, user: ImportUser, opts: ForeignImportOptions): Promise<ImportSummary> {
  if (user.role !== "ADMIN") throw forbidden();
  opts.onProgress?.({ phase: "validar" });
  const max = foreignMaxBytes();
  if ((await stat(file)).size > max) throw new AppError(opts.t("El archivo supera el tamaño máximo para JSON y CSV ({mb} MB).", { mb: Math.round(max / 1024 / 1024) }), 413);
  const text = decodeText(await readFile(file));
  const board = parseForeign(text, format, { t: opts.t, timeZone: appTimeZone(), fileName: opts.fileName });
  return createProjectFromBoard(board, format, user, opts);
}

/**
 * Crea un proyecto NUEVO a partir de un tablero neutro, todo en una transacción (si algo falla no queda nada). Las columnas
 * son las del tablero (o las de por defecto si no trae), el creador de todo es quien importa y las personas del origen
 * solo se asignan si coinciden por email o por nombre con un usuario activo (en un proyecto privado, solo quien importa).
 */
export async function createProjectFromBoard(board: ForeignBoard, source: ForeignFormat, user: ImportUser, opts: ForeignImportOptions): Promise<ImportSummary> {
  const { t } = opts;
  assertBoardLimits(board);
  opts.onProgress?.({ phase: "base de datos" });
  const warnings = [...board.warnings];
  const locale = toLocale((await db.user.findUnique({ where: { id: user.id }, select: { locale: true } }))?.locale);

  // --- Personas: por email y, si no hay, por nombre exacto (sin distinguir mayúsculas) cuando es único.
  // Los nombres y emails vienen del archivo (el de Trello sin tocar): sin controles (un NUL rompe la consulta) y de longitud razonable.
  const assigneesOf = board.tasks.map((x) => x.assignees.map(cleanPerson).filter((p) => p.email || p.name));
  const people = assigneesOf.flat();
  const emails = [...new Set(people.map((p) => p.email).filter((e): e is string => !!e))].slice(0, 500);
  const names = [...new Set(people.map((p) => p.name?.trim()).filter((n): n is string => !!n))].slice(0, 200);
  const candidates = emails.length || names.length
    ? await db.user.findMany({
        where: { active: true, OR: [...(emails.length ? [{ email: { in: emails } }] : []), ...names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } }))] },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const byEmail = new Map(candidates.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map<string, typeof candidates>();
  for (const u of candidates) {
    const same = byName.get(u.name.toLowerCase());
    if (same) same.push(u); else byName.set(u.name.toLowerCase(), [u]);
  }
  const allowed = (u: { id: string }) => !opts.isPrivate || u.id === user.id;
  const resolve = (p: ForeignPerson) => {
    const byMail = p.email ? byEmail.get(p.email) : undefined;
    if (byMail) return allowed(byMail) ? byMail : null;
    const sameName = p.name ? (byName.get(p.name.trim().toLowerCase()) ?? []) : [];
    return sameName.length === 1 && allowed(sameName[0]!) ? sameName[0]! : null;
  };
  const unmapped = new Map<string, { name: string; email: string }>();
  const memberIds = new Set<string>();

  // --- Columnas (las del tablero o las de por defecto) y tipo de tarea.
  const columnDefs = board.columns.length
    ? board.columns.map((name) => ({ name, role: "NONE" as const, isDone: isDoneName(name) }))
    : defaultColumns(locale);
  const projectId = newId();
  const columnIds = columnDefs.map(() => newId());
  const general = await db.taskKind.findFirst({ where: { projectId: null }, orderBy: { position: "asc" }, select: { id: true } });
  const ownKindId = general ? null : newId();
  const kindId = general?.id ?? ownKindId!;

  // --- Etiquetas: sin repetir (sin distinguir mayúsculas) y hasta el tope del proyecto.
  const labelIds = new Map<string, string>();
  const labelRows: Prisma.LabelCreateManyInput[] = [];
  let droppedLabels = 0;
  for (const task of board.tasks) {
    for (const l of task.labels) {
      const key = l.name.toLowerCase();
      if (labelIds.has(key)) continue;
      if (labelRows.length >= FOREIGN_LIMITS.labels) { droppedLabels++; continue; }
      const id = newId();
      labelIds.set(key, id);
      labelRows.push({ id, projectId, name: l.name, color: l.color ?? AUTO_COLORS[labelRows.length % AUTO_COLORS.length]! });
    }
  }
  if (droppedLabels) warnings.push(droppedLabels === 1 ? t("1 etiqueta sobraba (máximo {max} por proyecto) y no se ha importado.", { max: FOREIGN_LIMITS.labels }) : t("{n} etiquetas sobraban (máximo {max} por proyecto) y no se han importado.", { n: droppedLabels, max: FOREIGN_LIMITS.labels }));

  // --- Tareas.
  const now = new Date();
  const nextPos = new Map<number, number>();
  const taskRows: Prisma.TaskCreateManyInput[] = [];
  const taskLabelRows: Prisma.TaskLabelCreateManyInput[] = [];
  const subtaskRows: Prisma.SubtaskCreateManyInput[] = [];
  const commentRows: Prisma.TaskCommentCreateManyInput[] = [];
  let extraLabels = 0;
  board.tasks.forEach((task, taskIndex) => {
    const col = Math.min(task.column ?? 0, columnIds.length - 1);
    const pos = (nextPos.get(col) ?? 0) + POSITION_STEP;
    nextPos.set(col, pos);
    const id = newId();

    let assigneeId: string | null = null;
    const lost: string[] = [];
    for (const p of assigneesOf[taskIndex]!) {
      const found = resolve(p);
      const label = p.name ?? p.email ?? "";
      if (found && !assigneeId) {
        assigneeId = found.id;
        if (!opts.isPrivate && found.role !== "ADMIN" && found.id !== user.id) memberIds.add(found.id);
      } else if (label) {
        // Sin usuario que coincida, o una segunda persona (la tarea solo tiene un responsable): queda en la descripción.
        lost.push(label);
        // Solo con email (una columna de CSV con direcciones): sin nombre, para no mostrar el email dos veces.
        if (!found) unmapped.set(label.toLowerCase(), { name: p.name ?? "", email: p.email ?? "" });
      }
    }
    const description = lost.length ? clip(`${task.description}${task.description ? "\n\n" : ""}_${t("Responsable en el archivo original: {names}.", { names: lost.join(", ") })}_`, 20_000) : task.description;

    taskRows.push({
      id, projectId, columnId: columnIds[col]!, title: task.title, description, kindId, position: pos, assigneeId, createdById: user.id,
      dueDate: task.due ? isoToDate(task.due) : null, priority: task.priority, archivedAt: task.archived ? now : null, archivedFromColumnId: task.archived ? columnIds[col]! : null,
    });
    // Una tarea con más etiquetas de las que admite el editor (updateTask: 20) no se podría volver a guardar.
    const taskLabels = new Set<string>();
    for (const l of task.labels) {
      const labelId = labelIds.get(l.name.toLowerCase());
      if (!labelId || taskLabels.has(labelId)) continue;
      if (taskLabels.size >= FOREIGN_LIMITS.labelsPerTask) { extraLabels++; continue; }
      taskLabels.add(labelId);
      taskLabelRows.push({ taskId: id, labelId });
    }
    task.subtasks.forEach((s, i) => subtaskRows.push({ taskId: id, title: s.title, done: s.done, position: (i + 1) * POSITION_STEP }));
    for (const c of task.comments) commentRows.push({ id: newId(), taskId: id, authorId: user.id, body: c.body, createdAt: c.createdAt && c.createdAt.getTime() <= now.getTime() ? c.createdAt : now });
  });
  if (extraLabels) warnings.push(extraLabels === 1 ? t("1 etiqueta de tarea sobraba (máximo {max} por tarea) y no se ha importado.", { max: FOREIGN_LIMITS.labelsPerTask }) : t("{n} etiquetas de tareas sobraban (máximo {max} por tarea) y no se han importado.", { n: extraLabels, max: FOREIGN_LIMITS.labelsPerTask }));
  const fields = normalizeTaskFields(board.tasks.some((x) => x.priority) ? ["priority"] : []);
  const projectName = await freeProjectName(user, board.name, t("(importado)"));
  const last = await db.project.findFirst({ orderBy: { position: "desc" }, select: { position: true } });

  await db.$transaction(
    async (tx) => {
      await tx.project.create({
        data: {
          id: projectId, name: projectName, description: board.description, position: (last?.position ?? 0) + POSITION_STEP,
          isPrivate: opts.isPrivate, privateOwnerId: opts.isPrivate ? user.id : null, taskFields: fields,
        },
      });
      if (opts.isPrivate) await tx.projectMember.create({ data: { projectId, userId: user.id } });
      else await tx.adminProjectPick.create({ data: { projectId, userId: user.id } });
      if (memberIds.size) await tx.projectMember.createMany({ data: [...memberIds].map((userId) => ({ projectId, userId })) });
      await tx.column.createMany({
        data: columnDefs.map((c, i) => ({ id: columnIds[i]!, projectId, name: c.name, position: (i + 1) * POSITION_STEP, role: c.role, isDone: c.isDone })),
      });
      if (ownKindId) await tx.taskKind.create({ data: { id: ownKindId, projectId, name: t("Tarea"), color: PALETTE[0], position: POSITION_STEP } });
      if (labelRows.length) await tx.label.createMany({ data: labelRows });
      await insertChunks(taskRows, (rows) => tx.task.createMany({ data: rows }));
      await insertChunks(taskLabelRows, (rows) => tx.taskLabel.createMany({ data: rows, skipDuplicates: true }));
      await insertChunks(subtaskRows, (rows) => tx.subtask.createMany({ data: rows }));
      await insertChunks(commentRows, (rows) => tx.taskComment.createMany({ data: rows }));
    },
    { timeout: 5 * 60_000, maxWait: 60_000 },
  );

  return {
    projectId,
    name: projectName,
    source,
    counts: {
      columns: columnDefs.length, kinds: ownKindId ? 1 : 0, labels: labelRows.length, deliverables: 0, tasks: taskRows.length, archivedTasks: board.tasks.filter((x) => x.archived).length,
      subtasks: subtaskRows.length, comments: commentRows.length, taskAttachments: 0, releases: 0, releaseAttachments: 0, documents: 0, events: 0,
    },
    unmappedUsers: [...unmapped.values()],
    mappedUsers: new Set(taskRows.map((r) => r.assigneeId).filter(Boolean)).size,
    addedMembers: memberIds.size,
    warnings,
  };
}
