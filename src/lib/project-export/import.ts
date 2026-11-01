import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getT } from "@/i18n/server";
import { visibleProjectsWhere } from "../access";
import { FILE_MAX_MAX_MB, FILE_MAX_MIN_MB, effectiveFileMaxMb } from "../upload-size";
import { RELEASE_ZIP_MAX_MB, RELEASE_ZIP_MIN_MB } from "../constants";
import { isoToDate } from "../dates";
import { db } from "../db";
import { confirmDocumentKind, documentMime, sanitizeDocumentName } from "../document-kind";
import { AppError, forbidden } from "../errors";
import { googleWorkspaceDomain } from "../google-config";
import { isDomainMode } from "../google-share";
import { mentionToken } from "../mentions";
import { POSITION_STEP } from "../positions";
import { checkQuota } from "../quota";
import { quotaExceededFor, storageUsage } from "../storage-usage";
import { normalizeTaskFields } from "../task-fields";
import {
  processImportedImage, removeAttachmentFiles, removeDocumentFiles, removeReleaseAttachmentFiles, sanitizeMime, saveAttachmentFiles, saveDocumentFile,
  saveRawAttachmentFile, saveReleaseAttachmentFile,
} from "../uploads";
import { mapMentions } from "./mentions";
import { openProjectArchive, type ProjectArchive } from "./read";
import type { ProjectExportData } from "./types";

export interface ImportUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

export interface ImportSummary {
  projectId: string;
  name: string;
  counts: {
    columns: number; kinds: number; labels: number; deliverables: number; tasks: number; archivedTasks: number; subtasks: number; comments: number;
    taskAttachments: number; releases: number; releaseAttachments: number; documents: number; events: number;
  };
  /** Personas del archivo que no se pudieron emparejar con un usuario activo (por su email). */
  unmappedUsers: { name: string; email: string }[];
  mappedUsers: number;
  /** Usuarios de equipo añadidos como miembros por figurar en el archivo (no administradores). */
  addedMembers: number;
  /** Cosas que no se pudieron importar (ficheros demasiado grandes, imágenes dañadas…). */
  warnings: string[];
}

const newId = () => `c${randomBytes(12).toString("hex")}`;
const CHUNK = 1000;
const MAX_FILE_BYTES = (FILE_MAX_MAX_MB + 4) * 1024 * 1024;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const date = (iso: string) => new Date(iso);
const dateOrNull = (iso: string | null) => (iso ? new Date(iso) : null);

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/** Nombre libre entre los proyectos visibles para quien importa: el del archivo y, si ya existe, con «(importado)». */
async function freeProjectName(user: ImportUser, wanted: string, suffix: string): Promise<string> {
  const base = (wanted.trim() || "Proyecto").slice(0, 80);
  const taken = async (name: string) => (await db.project.count({ where: { name, ...visibleProjectsWhere(user as never) } })) > 0;
  if (!(await taken(base))) return base;
  for (let n = 1; n < 100; n++) {
    const tail = ` ${suffix}${n > 1 ? ` ${n}` : ""}`;
    const name = `${base.slice(0, 80 - tail.length).trimEnd()}${tail}`;
    if (!(await taken(name))) return name;
  }
  return `${base.slice(0, 60)} ${randomBytes(3).toString("hex")}`;
}

/**
 * Crea un proyecto NUEVO a partir de un archivo de exportación ya guardado en disco. Solo administradores.
 * Primero se valida todo el archivo (formato, versión, sumas, esquema) y se escriben los ficheros; después, todas las filas
 * en una sola transacción. Si algo falla se borran los ficheros escritos y no queda nada en la base de datos.
 */
export async function importProjectFile(file: string, user: ImportUser, opts: { isPrivate: boolean }): Promise<ImportSummary> {
  if (user.role !== "ADMIN") throw forbidden();
  const archive = await openProjectArchive(file);
  try {
    return await runImport(archive, user, opts);
  } finally {
    await archive.zip.close();
  }
}

async function runImport({ zip, data, files }: ProjectArchive, user: ImportUser, opts: { isPrivate: boolean }): Promise<ImportSummary> {
  const t = await getT();
  const warnings: string[] = [];

  // --- Personas: por email contra usuarios activos. En un proyecto privado solo vale quien importa.
  const wantedEmails = [...new Set(data.users.map((u) => u.email.trim().toLowerCase()))];
  const found = wantedEmails.length
    ? await db.user.findMany({ where: { active: true, email: { in: wantedEmails } }, select: { id: true, email: true, role: true } })
    : [];
  const byEmail = new Map(found.map((u) => [u.email.toLowerCase(), u]));
  const userMap = new Map<string, { id: string; role: "ADMIN" | "MEMBER" } | null>();
  for (const u of data.users) {
    const match = byEmail.get(u.email.trim().toLowerCase());
    userMap.set(u.ref, match && (!opts.isPrivate || match.id === user.id) ? { id: match.id, role: match.role } : null);
  }
  const uid = (ref: string | null): string | null => (ref ? (userMap.get(ref)?.id ?? null) : null);
  const nameOf = new Map(data.users.map((u) => [u.ref, u.name]));
  const unmappedUsers = data.users.filter((u) => !userMap.get(u.ref)).map((u) => ({ name: u.name, email: u.email }));
  const memberIds = opts.isPrivate
    ? []
    : [...new Set([...userMap.values()].filter((m): m is { id: string; role: "ADMIN" | "MEMBER" } => !!m && m.role !== "ADMIN" && m.id !== user.id).map((m) => m.id))];
  const text = (s: string) => mapMentions(s, (name, ref) => { const id = uid(ref); return id ? mentionToken(name, id) : `@${name}`; });

  // --- Cuota: comprobación previa con lo declarado (la definitiva se repite dentro de la transacción).
  const declared = [
    ...data.tasks.flatMap((x) => x.attachments.map((a) => a.size)),
    ...data.releases.flatMap((r) => r.attachments.map((a) => a.size)),
    ...data.documents.map((d) => d.size),
  ].reduce((n, s) => n + s, 0);
  const preQuota = checkQuota(await storageUsage("none"), declared);
  if (preQuota) throw quotaError(t, preQuota);

  const projectId = newId();
  const fileMaxMb = clamp(data.project.fileMaxMb, FILE_MAX_MIN_MB, FILE_MAX_MAX_MB);
  const taskMaxMb = clamp(data.project.taskAttachMaxMb, Math.max(fileMaxMb, RELEASE_ZIP_MIN_MB), RELEASE_ZIP_MAX_MB);
  const zipMaxMb = clamp(data.project.releaseZipMaxMb, Math.max(fileMaxMb, RELEASE_ZIP_MIN_MB), RELEASE_ZIP_MAX_MB);
  const fileMaxBytes = effectiveFileMaxMb(fileMaxMb) * 1024 * 1024;

  // --- Ficheros: se escriben antes (con los ids ya decididos) y, si algo falla, se borran.
  const written = { attachments: [] as string[], releaseAttachments: [] as string[], documents: [] as string[] };
  const loadFile = async (sha: string): Promise<Buffer> => zip.readAll(files.get(sha)!, MAX_FILE_BYTES);
  const tooBig = (what: string, size: number) => size > fileMaxBytes && (warnings.push(t("«{name}» supera el tamaño máximo de archivo del proyecto y no se ha importado.", { name: what })), true);

  type AttRow = Prisma.TaskAttachmentCreateManyInput;
  const attachmentRows: AttRow[] = [];
  const taskIds = new Map(data.tasks.map((x) => [x.ref, newId()]));
  try {
    for (const task of data.tasks) {
      for (const a of task.attachments) {
        if (tooBig(a.originalName, a.size)) continue;
        const id = newId();
        const buf = await loadFile(a.file);
        const name = a.originalName.replace(/[\\/\0]/g, "_").slice(0, 200) || "archivo";
        if (a.isImage) {
          let image;
          try {
            image = await processImportedImage(buf);
          } catch (err) {
            if (err instanceof AppError && err.status === 503) throw err;
            warnings.push(t("«{name}» no es una imagen válida y no se ha importado.", { name }));
            continue;
          }
          await saveAttachmentFiles(id, image);
          written.attachments.push(id);
          attachmentRows.push({
            id, taskId: taskIds.get(task.ref)!, originalName: name, mimeType: "image/webp", isImage: true, width: image.width, height: image.height,
            size: image.full.length, createdById: uid(a.createdBy), createdAt: date(a.createdAt),
          });
        } else {
          await saveRawAttachmentFile(id, buf);
          written.attachments.push(id);
          attachmentRows.push({
            id, taskId: taskIds.get(task.ref)!, originalName: name, mimeType: sanitizeMime(a.mimeType), isImage: false, width: null, height: null,
            size: buf.length, createdById: uid(a.createdBy), createdAt: date(a.createdAt),
          });
        }
      }
    }

    const releaseIds = new Map(data.releases.map((r) => [r.ref, newId()]));
    const releaseAttachmentRows: Prisma.ReleaseAttachmentCreateManyInput[] = [];
    for (const r of data.releases) {
      for (const a of r.attachments) {
        if (tooBig(a.fileName, a.size)) continue;
        const id = newId();
        let buf = await loadFile(a.file);
        if (a.isImage) {
          try {
            buf = (await processImportedImage(buf)).full;
          } catch (err) {
            if (err instanceof AppError && err.status === 503) throw err;
            warnings.push(t("«{name}» no es una imagen válida y no se ha importado.", { name: a.fileName }));
            continue;
          }
        }
        await saveReleaseAttachmentFile(id, buf, a.isImage ? "webp" : "bin");
        written.releaseAttachments.push(id);
        releaseAttachmentRows.push({ id, releaseId: releaseIds.get(r.ref)!, fileName: a.fileName, size: buf.length, isImage: a.isImage, position: a.position, createdAt: date(a.createdAt) });
      }
    }

    const documentRows: Prisma.ProjectDocumentCreateManyInput[] = [];
    for (const d of data.documents) {
      if (tooBig(d.name, d.size)) continue;
      const id = newId();
      const buf = await loadFile(d.file);
      const name = sanitizeDocumentName(d.name);
      let kind = confirmDocumentKind(d.kind, buf);
      let stored: Buffer = buf;
      if (kind === "IMAGE") {
        try {
          stored = (await processImportedImage(buf)).full;
        } catch (err) {
          if (err instanceof AppError && err.status === 503) throw err;
          kind = "OTHER"; // no es una imagen que sharp entienda: queda como descarga
        }
      }
      await saveDocumentFile(id, stored);
      written.documents.push(id);
      documentRows.push({
        id, projectId, name, mimeType: documentMime(kind, sanitizeMime(d.mimeType)), size: stored.length, kind, createdById: uid(d.createdBy),
        createdAt: date(d.createdAt), updatedAt: date(d.updatedAt),
      });
    }

    // --- Base de datos: todo o nada.
    const projectName = await freeProjectName(user, data.project.name, t("(importado)"));
    const last = await db.project.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const general = await db.taskKind.findMany({ where: { projectId: null }, select: { id: true, name: true } });
    const generalByName = new Map(general.map((k) => [k.name.toLowerCase(), k.id]));

    const columnIds = new Map(data.columns.map((c) => [c.ref, newId()]));
    // Tipos: los generales se emparejan por nombre; si no existen aquí, se crean como tipos propios del proyecto.
    const kindIds = new Map<string, string>();
    const ownKindByName = new Map<string, string>();
    const kindRows: Prisma.TaskKindCreateManyInput[] = [];
    for (const k of [...data.kinds].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1))) {
      const lower = k.name.toLowerCase();
      const existing = k.scope === "general" ? generalByName.get(lower) : undefined;
      if (existing) { kindIds.set(k.ref, existing); continue; }
      const dupe = ownKindByName.get(lower);
      if (dupe) { kindIds.set(k.ref, dupe); continue; }
      const id = newId();
      kindIds.set(k.ref, id);
      ownKindByName.set(lower, id);
      kindRows.push({ id, projectId, name: k.name, color: k.color, position: k.position, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate });
    }
    const labelIds = new Map(data.labels.map((l) => [l.ref, newId()]));
    const deliverableIds = new Map(data.deliverables.map((d) => [d.ref, newId()]));
    const hiddenKindIds = [...new Set(data.hiddenGeneralKinds.map((n) => generalByName.get(n.toLowerCase())).filter((x): x is string => !!x))];

    const fields = normalizeTaskFields(data.project.taskFields);
    if (data.columns.some((c) => c.role === "BUDGET") && !fields.includes("cost")) fields.unshift("cost");
    const shareMode = data.project.googleShareMode && isDomainMode(data.project.googleShareMode) && (opts.isPrivate || !googleWorkspaceDomain()) ? null : data.project.googleShareMode;

    const taskRows: Prisma.TaskCreateManyInput[] = data.tasks.map((x) => ({
      id: taskIds.get(x.ref)!,
      projectId,
      columnId: columnIds.get(x.columnRef)!,
      title: text(x.title),
      description: text(x.description),
      kindId: kindIds.get(x.kindRef)!,
      color: x.color,
      linkUrl: x.linkUrl && /^https?:\/\/\S+$/i.test(x.linkUrl) ? x.linkUrl : null,
      position: x.position,
      assigneeId: uid(x.assignee),
      createdById: uid(x.createdBy),
      dueDate: x.dueDate ? isoToDate(x.dueDate) : null,
      startDate: x.startDate ? isoToDate(x.startDate) : null,
      deliverableId: x.deliverableRef ? deliverableIds.get(x.deliverableRef)! : null,
      archivedAt: dateOrNull(x.archivedAt),
      archivedFromColumnId: x.archivedFromColumnRef ? columnIds.get(x.archivedFromColumnRef)! : null,
      columnEnteredAt: date(x.columnEnteredAt),
      evergreen: x.evergreen,
      evergreenEvery: x.evergreenEvery,
      cost: x.cost,
      costPaid: x.costPaid,
      estimatedHours: x.estimatedHours,
      actualHours: x.actualHours,
      priority: x.priority,
      client: x.client,
      recurrence: x.recurrence,
      recurrenceDay: x.recurrenceDay,
      contentUpdatedAt: dateOrNull(x.contentUpdatedAt),
      createdAt: date(x.createdAt),
      updatedAt: date(x.updatedAt),
    }));

    const commentRows: (Prisma.TaskCommentCreateManyInput & { parentRef: string | null; ref: string })[] = [];
    const noteRows: Prisma.TaskCommentCreateManyInput[] = [];
    const now = new Date();
    for (const x of data.tasks) {
      const taskId = taskIds.get(x.ref)!;
      for (const c of x.comments) {
        const authorId = uid(c.author);
        commentRows.push({
          id: newId(), ref: `${x.ref}/${c.ref}`, parentRef: c.parentRef ? `${x.ref}/${c.parentRef}` : null, taskId, authorId,
          authorName: authorId ? null : (c.author ? (nameOf.get(c.author) ?? c.authorName) : c.authorName) ?? null,
          body: text(c.body), createdAt: date(c.createdAt), editedAt: dateOrNull(c.editedAt), deletedAt: dateOrNull(c.deletedAt),
        });
      }
      // Quien estaba asignado o creó la tarea y no existe aquí: queda constancia en una nota.
      const lost = [
        x.assignee && !uid(x.assignee) ? t("Asignada originalmente a {name}.", { name: nameOf.get(x.assignee) ?? "?" }) : null,
        x.createdBy && !uid(x.createdBy) ? t("Creada originalmente por {name}.", { name: nameOf.get(x.createdBy) ?? "?" }) : null,
      ].filter((s): s is string => !!s);
      if (lost.length) noteRows.push({ id: newId(), taskId, authorId: user.id, body: [t("Importada desde un archivo."), ...lost].join(" "), createdAt: now });
    }

    const releaseRows: Prisma.ReleaseCreateManyInput[] = data.releases.map((r) => ({
      id: releaseIds.get(r.ref)!, projectId, number: r.number, title: r.title, content: r.content, createdById: uid(r.createdBy), deployedAt: date(r.deployedAt),
    }));
    const releaseTaskRows: Prisma.ReleaseTaskCreateManyInput[] = data.releases.flatMap((r) =>
      r.tasks.map((x) => ({ releaseId: releaseIds.get(r.ref)!, taskId: x.taskRef ? taskIds.get(x.taskRef)! : null, title: x.title, kindName: x.kindName })),
    );

    await db.$transaction(
      async (tx) => {
        // Mismo candado que las subidas: la cuota se comprueba al final con todo lo escrito.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:attachment-quota'))::text`;
        await tx.project.create({
          data: {
            id: projectId,
            name: projectName,
            description: data.project.description,
            position: (last?.position ?? 0) + POSITION_STEP,
            isPrivate: opts.isPrivate,
            privateOwnerId: opts.isPrivate ? user.id : null,
            releaseZipMaxMb: zipMaxMb,
            taskAttachMaxMb: taskMaxMb,
            fileMaxMb,
            googleShareMode: shareMode,
            taskFields: fields,
          },
        });
        // Quien importa: miembro si es privado, o proyecto de trabajo suyo si es de equipo (como al crear uno).
        if (opts.isPrivate) await tx.projectMember.create({ data: { projectId, userId: user.id } });
        else await tx.adminProjectPick.create({ data: { projectId, userId: user.id } });
        if (memberIds.length) await tx.projectMember.createMany({ data: memberIds.map((userId) => ({ projectId, userId })) });
        if (data.reportSchedule) await tx.reportSchedule.create({ data: { projectId, recipient: user.email, createdById: user.id, ...data.reportSchedule } });
        if (data.releaseTemplates.length) await tx.projectReleaseTemplate.createMany({ data: data.releaseTemplates.map((r) => ({ ...r, projectId })) });

        await tx.column.createMany({
          data: data.columns.map((c) => ({ id: columnIds.get(c.ref)!, projectId, name: c.name, position: c.position, role: c.role, isDone: c.isDone, waitingDays: c.waitingDays })),
        });
        for (const c of data.columns) {
          if (c.routineTargetRef) await tx.column.update({ where: { id: columnIds.get(c.ref)! }, data: { routineTargetColumnId: columnIds.get(c.routineTargetRef)! } });
        }
        if (kindRows.length) await tx.taskKind.createMany({ data: kindRows });
        if (hiddenKindIds.length) await tx.projectHiddenKind.createMany({ data: hiddenKindIds.map((kindId) => ({ projectId, kindId })) });
        if (data.labels.length) await tx.label.createMany({ data: data.labels.map((l) => ({ id: labelIds.get(l.ref)!, projectId, name: l.name, color: l.color })) });
        if (data.deliverables.length) {
          await tx.deliverable.createMany({
            data: data.deliverables.map((d) => ({
              id: deliverableIds.get(d.ref)!, projectId, name: d.name, description: d.description, dueDate: d.dueDate ? isoToDate(d.dueDate) : null, position: d.position, createdAt: date(d.createdAt),
            })),
          });
        }

        await insertChunks(taskRows, (rows) => tx.task.createMany({ data: rows }));
        for (const x of data.tasks) {
          if (x.recurrenceFromRef) await tx.task.update({ where: { id: taskIds.get(x.ref)! }, data: { recurrenceFromId: taskIds.get(x.recurrenceFromRef)! } });
        }
        // Prisma pone la fecha de modificación al insertar aunque se indique: se restituye la del archivo.
        if (data.tasks.length) {
          await tx.$executeRaw`UPDATE "Task" AS t SET "updatedAt" = d.u::timestamp FROM unnest(${data.tasks.map((x) => taskIds.get(x.ref)!)}::text[], ${data.tasks.map((x) => x.updatedAt)}::text[]) AS d(id, u) WHERE t."id" = d.id`;
        }
        await insertChunks(
          data.tasks.flatMap((x) => x.labelRefs.map((l) => ({ taskId: taskIds.get(x.ref)!, labelId: labelIds.get(l)! }))),
          (rows) => tx.taskLabel.createMany({ data: rows, skipDuplicates: true }),
        );
        await insertChunks(
          data.tasks.flatMap((x) => x.subtasks.map((s) => ({ taskId: taskIds.get(x.ref)!, title: s.title, done: s.done, position: s.position }))),
          (rows) => tx.subtask.createMany({ data: rows }),
        );
        await insertChunks(
          data.tasks.flatMap((x) => {
            const seen = new Set<string>();
            return x.followers.flatMap((f) => {
              const userId = uid(f.user);
              if (!userId || seen.has(userId)) return [];
              seen.add(userId);
              return [{ taskId: taskIds.get(x.ref)!, userId, muted: f.muted }];
            });
          }),
          (rows) => tx.taskFollower.createMany({ data: rows }),
        );
        await insertChunks(
          data.tasks.flatMap((x) =>
            x.links.flatMap((l) => (/^https?:\/\/\S+$/i.test(l.url) ? [{ taskId: taskIds.get(x.ref)!, kind: l.kind, title: l.title, url: l.url, createdById: uid(l.createdBy), createdAt: date(l.createdAt) }] : [])),
          ),
          (rows) => tx.taskLink.createMany({ data: rows }),
        );

        // Comentarios: primero los raíz y luego las respuestas (la respuesta apunta a su comentario).
        const idByRef = new Map(commentRows.map((c) => [c.ref, c.id!]));
        let pending = commentRows;
        const inserted = new Set<string>();
        while (pending.length) {
          const wave = pending.filter((c) => !c.parentRef || !idByRef.has(c.parentRef) || inserted.has(c.parentRef));
          const batch = wave.length ? wave : pending; // sin progreso (ciclo en un archivo manipulado): se cortan los hilos
          await insertChunks(batch, (rows) =>
            tx.taskComment.createMany({
              data: rows.map(({ ref, parentRef, ...c }) => ({ ...c, parentId: !wave.length || !parentRef ? null : (idByRef.get(parentRef) ?? null) })),
            }),
          );
          for (const c of batch) inserted.add(c.ref);
          pending = pending.filter((c) => !inserted.has(c.ref));
        }
        await insertChunks(noteRows, (rows) => tx.taskComment.createMany({ data: rows }));
        await insertChunks(attachmentRows, (rows) => tx.taskAttachment.createMany({ data: rows }));

        await insertChunks(releaseRows, (rows) => tx.release.createMany({ data: rows }));
        await insertChunks(releaseTaskRows, (rows) => tx.releaseTask.createMany({ data: rows }));
        await insertChunks(releaseAttachmentRows, (rows) => tx.releaseAttachment.createMany({ data: rows }));
        await insertChunks(documentRows, (rows) => tx.projectDocument.createMany({ data: rows }));
        if (documentRows.length) {
          await tx.$executeRaw`UPDATE "ProjectDocument" AS t SET "updatedAt" = d.u::timestamp FROM unnest(${documentRows.map((r) => r.id!)}::text[], ${documentRows.map((r) => (r.updatedAt as Date).toISOString())}::text[]) AS d(id, u) WHERE t."id" = d.id`;
        }
        await insertChunks(
          data.events.map((e) => ({ taskId: taskIds.get(e.taskRef)!, projectId, userId: uid(e.user), userName: e.userName, code: e.code, label: e.label, createdAt: date(e.createdAt) })),
          (rows) => tx.taskEvent.createMany({ data: rows }),
        );

        const quota = await quotaExceededFor(projectId, 0, tx);
        if (quota) throw quotaError(t, quota);
      },
      { timeout: 10 * 60_000, maxWait: 60_000 },
    );

    return {
      projectId,
      name: projectName,
      counts: {
        columns: data.columns.length, kinds: kindRows.length, labels: data.labels.length, deliverables: data.deliverables.length,
        tasks: data.tasks.length, archivedTasks: data.tasks.filter((x) => x.archivedAt).length,
        subtasks: data.tasks.reduce((n, x) => n + x.subtasks.length, 0), comments: commentRows.length,
        taskAttachments: attachmentRows.length, releases: releaseRows.length, releaseAttachments: releaseAttachmentRows.length,
        documents: documentRows.length, events: data.events.length,
      },
      unmappedUsers,
      mappedUsers: data.users.length - unmappedUsers.length,
      addedMembers: memberIds.length,
      warnings,
    };
  } catch (err) {
    // Nada de lo escrito sobrevive a un fallo.
    await Promise.all([removeAttachmentFiles(written.attachments), removeReleaseAttachmentFiles(written.releaseAttachments), removeDocumentFiles(written.documents)]);
    throw err;
  }
}

function quotaError(t: Awaited<ReturnType<typeof getT>>, q: { scope: "project" | "total"; usedMb: number; limitMb: number }): AppError {
  const vars = { used: q.usedMb, limit: q.limitMb };
  return new AppError(
    q.scope === "project"
      ? t("Cuota de adjuntos del proyecto superada: {used} MB usados de {limit} MB.", vars)
      : t("Cuota total de adjuntos del servidor superada: {used} MB usados de {limit} MB.", vars),
    413,
  );
}
