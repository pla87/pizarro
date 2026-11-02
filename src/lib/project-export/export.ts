import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { crc32 } from "node:zlib";
import pkg from "../../../package.json";
import type { Prisma } from "@/generated/prisma/client";
import { dateToIso, todayIso } from "../dates";
import { db } from "../db";
import { AppError } from "../errors";
import { appTimeZone } from "../format";
import { attachmentPath, documentPath, readReleaseAttachmentFile } from "../uploads";
import { streamZipSize, type StreamZipEntry } from "../zip-stream";
import { mapMentions } from "./mentions";
import {
  EXPORT_EXTENSION, EXPORT_FORMAT, EXPORT_FORMAT_VERSION, projectDataSchema,
  type ExportCounts, type ExportManifest, type ExportOptions, type ProjectExportData,
} from "./types";

/** Tope de project.json: se arma en memoria. */
const MAX_PROJECT_JSON_BYTES = 64 * 1024 * 1024;
const CHUNK = 400;

export interface ProjectExport {
  filename: string;
  manifest: ExportManifest;
  /** Entradas del ZIP en orden: manifest.json, project.json y files/<sha>. */
  entries: StreamZipEntry[];
  /** Bytes del ZIP completo. */
  size: number;
  /** Adjuntos que figuraban en la base de datos pero ya no estaban en disco (se omiten del archivo). */
  missingFiles: number;
}

/** Nombre apto para ficheros a partir del nombre del proyecto: minúsculas, sin acentos, con guiones. */
export function projectSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slug || "proyecto";
}

export const exportFileName = (projectName: string, now: Date = new Date(), timeZone?: string): string =>
  `pizarro-${projectSlug(projectName)}-${todayIso(timeZone, now).replace(/-/g, "")}${EXPORT_EXTENSION}`;

/** Refs de personas: «u1», «u2»… por orden de aparición. Los datos se rellenan al final. */
class UserRefs {
  private readonly ids = new Map<string, string>();
  ref(id: string | null | undefined): string | null {
    if (!id) return null;
    let r = this.ids.get(id);
    if (!r) {
      r = `u${this.ids.size + 1}`;
      this.ids.set(id, r);
    }
    return r;
  }
  entries(): [string, string][] {
    return [...this.ids];
  }
}

interface FileInfo {
  sha: string;
  size: number;
  crc: number;
  open: () => AsyncIterable<Buffer>;
}

/** SHA-256 y CRC-32 de un fichero en una sola pasada. */
async function hashSource(open: () => AsyncIterable<Buffer>): Promise<{ sha: string; size: number; crc: number }> {
  const h = createHash("sha256");
  let size = 0;
  let crc = 0;
  for await (const chunk of open()) {
    h.update(chunk);
    crc = crc32(chunk, crc);
    size += chunk.length;
  }
  return { sha: h.digest("hex"), size, crc };
}

/** Lee un fichero del disco por trozos (Buffer). */
const diskStream = (file: string) => () => createReadStream(file) as unknown as AsyncIterable<Buffer>;

/** Registra un fichero y devuelve su huella; null si ya no está en disco. `tick` avisa de cada fichero examinado (progreso). */
async function addFile(files: Map<string, FileInfo>, open: () => AsyncIterable<Buffer>, exists: () => Promise<boolean>, tick?: () => void): Promise<FileInfo | null> {
  try {
    tick?.();
    if (!(await exists())) return null;
    const { sha, size, crc } = await hashSource(open);
    const prev = files.get(sha);
    if (prev) return prev;
    const info = { sha, size, crc, open };
    files.set(sha, info);
    return info;
  } catch {
    return null;
  }
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Reúne el proyecto y arma el plan del ZIP (nada se escribe todavía: las entradas con ficheros se leen del disco al emitirlas).
 * Sin comprobar permisos: quien llama ya lo hizo.
 */
export async function buildProjectExport(projectId: string, options: ExportOptions, now: Date = new Date(), onFile?: () => void): Promise<ProjectExport> {
  // Todas las lecturas ven la misma foto de la base de datos: una edición simultánea no deja referencias colgadas.
  return db.$transaction((tx) => buildInSnapshot(tx, projectId, options, now, onFile), { isolationLevel: "RepeatableRead", timeout: 30 * 60_000, maxWait: 60_000 });
}

/** Referencia que debería existir; si no, el archivo saldría roto y es mejor fallar con un mensaje claro. */
function must<T>(map: Map<string, T>, key: string): T {
  const v = map.get(key);
  if (v === undefined) throw new AppError("El proyecto cambió mientras se exportaba y el archivo habría quedado incompleto. Vuelve a intentarlo.", 409);
  return v;
}

async function buildInSnapshot(db: Prisma.TransactionClient, projectId: string, options: ExportOptions, now: Date, onFile?: () => void): Promise<ProjectExport> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true, description: true, isPrivate: true, taskFields: true, releaseZipMaxMb: true, taskAttachMaxMb: true, fileMaxMb: true, googleShareMode: true,
      reportSchedule: { select: { enabled: true, weekday: true, hour: true } },
      releaseTemplates: { orderBy: [{ kind: "asc" }, { position: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { kind: true, name: true, content: true, position: true, createdAt: true } },
      columns: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true } },
      kinds: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true, position: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true, createdAt: true } },
      hiddenKinds: { select: { kind: { select: { name: true } } } },
      labels: { orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true } },
      deliverables: { orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, description: true, dueDate: true, position: true, createdAt: true } },
    },
  });
  if (!project) throw new AppError("No encontrado o sin acceso.", 404);

  const users = new UserRefs();
  const files = new Map<string, FileInfo>();
  let missingFiles = 0;
  const taskWhere: Prisma.TaskWhereInput = { projectId, ...(options.scope === "board" ? { archivedAt: null } : {}) };

  // Refs de columnas, etiquetas y entregables (por orden).
  const columnRef = new Map(project.columns.map((c, i) => [c.id, `c${i + 1}`]));
  const labelRef = new Map(project.labels.map((l, i) => [l.id, `l${i + 1}`]));
  const deliverableRef = new Map(project.deliverables.map((d, i) => [d.id, `d${i + 1}`]));

  // Tareas en orden estable; el resto de su contenido se lee por lotes.
  const orderedIds = (
    await db.task.findMany({ where: taskWhere, orderBy: [{ column: { position: "asc" } }, { position: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true } })
  ).map((t) => t.id);
  const taskRef = new Map(orderedIds.map((id, i) => [id, `t${i + 1}`]));

  // Tipos: los del proyecto y los generales que usan sus tareas.
  const usedKindIds = new Set((await db.task.groupBy({ by: ["kindId"], where: taskWhere })).map((g) => g.kindId));
  const generalUsed = usedKindIds.size
    ? await db.taskKind.findMany({
        where: { id: { in: [...usedKindIds] }, projectId: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, color: true, position: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true, createdAt: true },
      })
    : [];
  const kindList = [...project.kinds.map((k) => ({ ...k, scope: "project" as const })), ...generalUsed.map((k) => ({ ...k, scope: "general" as const }))];
  const kindRef = new Map(kindList.map((k, i) => [k.id, `k${i + 1}`]));

  // Las menciones se dejan como están y se reescriben al final, cuando se sabe qué personas existen.
  const mentionIds = new Set<string>();
  const mention = (text: string) => {
    mapMentions(text, (name, id) => { mentionIds.add(id); return name; });
    return text;
  };

  // Tareas.
  const tasks: ProjectExportData["tasks"] = [];
  let commentCount = 0;
  let subtaskCount = 0;
  let commentSeq = 0;
  // Cota inferior del tamaño de project.json (los caracteres de los textos, que en UTF-8 nunca pesan menos): si ya pasa
  // del tope, falla antes de examinar los adjuntos de las tareas siguientes, que es lo que tarda.
  let textChars = 0;
  for (let i = 0; i < orderedIds.length; i += CHUNK) {
    const ids = orderedIds.slice(i, i + CHUNK);
    const rows = await db.task.findMany({
      where: { id: { in: ids } },
      include: {
        labels: { select: { labelId: true } },
        subtasks: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        followers: { orderBy: [{ createdAt: "asc" }, { userId: "asc" }] },
        comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        links: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      textChars += r.title.length + r.description.length;
      for (const c of r.comments) textChars += c.body.length;
      for (const s of r.subtasks) textChars += s.title.length;
    }
    if (textChars > MAX_PROJECT_JSON_BYTES) throw new AppError("El proyecto es demasiado grande para exportarlo (el contenido supera 64 MB). Prueba con «Solo el tablero».", 413);
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      const commentRefs = new Map(t.comments.map((c) => [c.id, `m${++commentSeq}`]));
      const attachments: ProjectExportData["tasks"][number]["attachments"] = [];
      if (options.attachments) {
        for (const a of t.attachments) {
          const file = attachmentPath(a.id, a.isImage ? "full" : "file");
          const info = await addFile(files, diskStream(file), async () => (await stat(file)).isFile(), onFile);
          if (!info) {
            missingFiles++;
            continue;
          }
          attachments.push({
            originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage, width: a.width, height: a.height, size: info.size,
            createdBy: users.ref(a.createdById), createdAt: iso(a.createdAt), file: info.sha,
          });
        }
      }
      commentCount += t.comments.length;
      subtaskCount += t.subtasks.length;
      tasks.push({
        ref: taskRef.get(id)!,
        title: mention(t.title),
        description: mention(t.description),
        columnRef: must(columnRef, t.columnId),
        kindRef: must(kindRef, t.kindId),
        color: t.color,
        linkUrl: t.linkUrl,
        position: t.position,
        assignee: users.ref(t.assigneeId),
        createdBy: users.ref(t.createdById),
        dueDate: dateToIso(t.dueDate),
        startDate: dateToIso(t.startDate),
        deliverableRef: t.deliverableId ? (deliverableRef.get(t.deliverableId) ?? null) : null,
        archivedAt: isoOrNull(t.archivedAt),
        archivedFromColumnRef: t.archivedFromColumnId ? (columnRef.get(t.archivedFromColumnId) ?? null) : null,
        columnEnteredAt: iso(t.columnEnteredAt),
        evergreen: t.evergreen,
        evergreenEvery: t.evergreenEvery,
        cost: t.cost ? t.cost.toFixed(2) : null,
        costPaid: t.costPaid,
        estimatedHours: t.estimatedHours ? t.estimatedHours.toFixed(2) : null,
        actualHours: t.actualHours ? t.actualHours.toFixed(2) : null,
        priority: t.priority,
        client: t.client,
        recurrence: t.recurrence,
        recurrenceDay: t.recurrenceDay,
        recurrenceFromRef: t.recurrenceFromId ? (taskRef.get(t.recurrenceFromId) ?? null) : null,
        blockedByRef: t.blockedById ? (taskRef.get(t.blockedById) ?? null) : null,
        routineColumnRef: t.routineColumnId ? (columnRef.get(t.routineColumnId) ?? null) : null,
        waitingNotifiedAt: isoOrNull(t.waitingNotifiedAt),
        contentUpdatedAt: isoOrNull(t.contentUpdatedAt),
        contentUpdatedByRef: users.ref(t.contentUpdatedById),
        createdAt: iso(t.createdAt),
        updatedAt: iso(t.updatedAt),
        labelRefs: t.labels.map((l) => labelRef.get(l.labelId)).filter((r): r is string => !!r).sort(),
        subtasks: t.subtasks.map((s) => ({ title: s.title, done: s.done, position: s.position })),
        followers: t.followers.map((f) => ({ user: users.ref(f.userId)!, muted: f.muted, createdAt: iso(f.createdAt) })),
        comments: t.comments.map((c) => ({
          ref: commentRefs.get(c.id)!,
          author: users.ref(c.authorId),
          authorName: c.authorId ? null : c.authorName,
          body: mention(c.body),
          createdAt: iso(c.createdAt),
          editedAt: isoOrNull(c.editedAt),
          parentRef: c.parentId ? (commentRefs.get(c.parentId) ?? null) : null,
          deletedAt: isoOrNull(c.deletedAt),
        })),
        attachments,
        links: t.links.map((l) => ({ kind: l.kind, title: l.title, url: l.url, createdBy: users.ref(l.createdById), createdAt: iso(l.createdAt) })),
      });
    }
  }

  // Releases con su contenido y adjuntos (solo con el histórico completo).
  const releases: ProjectExportData["releases"] = [];
  let releaseAttachmentCount = 0;
  if (options.scope === "all") {
    const rows = await db.release.findMany({
      where: { projectId },
      orderBy: [{ number: "asc" }],
      include: { tasks: { orderBy: { id: "asc" } }, attachments: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    for (const [i, r] of rows.entries()) {
      const attachments: ProjectExportData["releases"][number]["attachments"] = [];
      if (options.attachments) {
        for (const a of r.attachments) {
          const open = () => (async function* () { yield await readReleaseAttachmentFile(a.id); })();
          const info = await addFile(files, open, async () => true, onFile);
          if (!info) {
            missingFiles++;
            continue;
          }
          attachments.push({ fileName: a.fileName, size: info.size, isImage: a.isImage, position: a.position, createdAt: iso(a.createdAt), file: info.sha });
        }
      }
      releaseAttachmentCount += attachments.length;
      releases.push({
        ref: `r${i + 1}`,
        number: r.number,
        title: r.title,
        content: r.content,
        createdBy: users.ref(r.createdById),
        deployedAt: iso(r.deployedAt),
        tasks: r.tasks.map((x) => ({ taskRef: x.taskId ? (taskRef.get(x.taskId) ?? null) : null, title: x.title, kindName: x.kindName })),
        attachments,
      });
    }
  }

  // Documentación (sin la papelera). Sin ficheros no tiene sentido: solo con adjuntos.
  const documents: ProjectExportData["documents"] = [];
  if (options.attachments) {
    const rows = await db.projectDocument.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    for (const d of rows) {
      const file = documentPath(d.id);
      const info = await addFile(files, diskStream(file), async () => (await stat(file)).isFile(), onFile);
      if (!info) {
        missingFiles++;
        continue;
      }
      documents.push({ ref: `x${documents.length + 1}`, name: d.name, mimeType: d.mimeType, size: info.size, kind: d.kind, createdBy: users.ref(d.createdById), createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt), file: info.sha });
    }
  }

  // Historial de cambios de las tareas (solo con el histórico completo).
  const events: ProjectExportData["events"] = [];
  if (options.scope === "all") {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.taskEvent.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 5000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      for (const e of rows) {
        const tr = taskRef.get(e.taskId);
        if (!tr) continue;
        events.push({ taskRef: tr, user: users.ref(e.userId), userName: e.userName, code: e.code, label: e.label, createdAt: iso(e.createdAt) });
      }
      if (rows.length < 5000) break;
    }
  }

  // Personas citadas (las que ya no existen se omiten: sus refs quedan sin resolver y al importar salen como texto).
  const userRows = await db.user.findMany({ where: { id: { in: [...new Set([...users.entries().map(([id]) => id), ...mentionIds])] } }, select: { id: true, name: true, email: true } });
  const userById = new Map(userRows.map((u) => [u.id, u]));
  // Menciones: la de una persona que existe lleva su ref; la de una que ya no, queda como texto.
  const fixMentions = (text: string) => mapMentions(text, (name, id) => (userById.has(id) ? `@[${name}](user:${users.ref(id)})` : `@${name}`));
  for (const t of tasks) {
    t.title = fixMentions(t.title);
    t.description = fixMentions(t.description);
    for (const c of t.comments) c.body = fixMentions(c.body);
  }
  const userList = users.entries().flatMap(([id, ref]) => {
    const u = userById.get(id);
    return u ? [{ ref, name: u.name, email: u.email }] : [];
  });

  const data: ProjectExportData = {
    users: userList,
    project: {
      name: project.name,
      description: project.description,
      visibility: project.isPrivate ? "PRIVATE" : "TEAM",
      taskFields: project.taskFields as ProjectExportData["project"]["taskFields"],
      releaseZipMaxMb: project.releaseZipMaxMb,
      taskAttachMaxMb: project.taskAttachMaxMb,
      fileMaxMb: project.fileMaxMb,
      googleShareMode: (project.googleShareMode as ProjectExportData["project"]["googleShareMode"]) ?? null,
    },
    reportSchedule: project.reportSchedule,
    releaseTemplates: project.releaseTemplates.map((r) => ({ kind: r.kind, name: r.name, content: r.content, position: r.position, createdAt: iso(r.createdAt) })),
    columns: project.columns.map((c) => ({
      ref: columnRef.get(c.id)!, name: c.name, position: c.position, role: c.role, isDone: c.isDone, waitingDays: c.waitingDays,
      routineTargetRef: c.routineTargetColumnId ? (columnRef.get(c.routineTargetColumnId) ?? null) : null,
      wipLimit: c.wipLimit,
    })),
    kinds: kindList.map((k) => ({
      ref: kindRef.get(k.id)!, name: k.name, color: k.color, position: k.position, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate,
      subtaskTemplate: k.subtaskTemplate, scope: k.scope, createdAt: iso(k.createdAt),
    })),
    hiddenGeneralKinds: project.hiddenKinds.map((h) => h.kind.name).sort(),
    labels: project.labels.map((l) => ({ ref: labelRef.get(l.id)!, name: l.name, color: l.color })),
    deliverables: project.deliverables.map((d) => ({
      ref: deliverableRef.get(d.id)!, name: d.name, description: d.description, dueDate: dateToIso(d.dueDate), position: d.position, createdAt: iso(d.createdAt),
    })),
    tasks,
    releases,
    documents,
    events,
  };
  // Lo que se escribe tiene que cumplir el esquema que exige el importador.
  projectDataSchema.parse(data);

  const projectJson = Buffer.from(JSON.stringify(data), "utf8");
  if (projectJson.length > MAX_PROJECT_JSON_BYTES) throw new AppError("El proyecto es demasiado grande para exportarlo (el contenido supera 64 MB). Prueba con «Solo el tablero».", 413);

  const counts: ExportCounts = {
    columns: data.columns.length, kinds: data.kinds.length, labels: data.labels.length, deliverables: data.deliverables.length,
    tasks: tasks.length, archivedTasks: tasks.filter((t) => t.archivedAt).length, subtasks: subtaskCount, comments: commentCount,
    taskAttachments: tasks.reduce((n, t) => n + t.attachments.length, 0), releases: releases.length, releaseAttachments: releaseAttachmentCount,
    documents: documents.length, events: events.length, files: files.size,
  };
  const checksums: Record<string, string> = { "project.json": createHash("sha256").update(projectJson).digest("hex") };
  for (const f of [...files.values()].sort((a, b) => a.sha.localeCompare(b.sha))) checksums[`files/${f.sha}`] = f.sha;
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: pkg.version,
    exportedAt: now.toISOString(),
    options: { attachments: options.attachments, scope: options.scope },
    timeZone: appTimeZone(),
    counts,
    checksums,
  };
  const manifestJson = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const entries: StreamZipEntry[] = [
    { name: "manifest.json", size: manifestJson.length, crc: crc32(manifestJson), body: manifestJson },
    { name: "project.json", size: projectJson.length, crc: crc32(projectJson), body: projectJson },
    ...[...files.values()].sort((a, b) => a.sha.localeCompare(b.sha)).map((f) => ({ name: `files/${f.sha}`, size: f.size, crc: f.crc, body: f.open })),
  ];
  let size: number;
  try {
    size = streamZipSize(entries);
  } catch {
    throw new AppError("El proyecto es demasiado grande para un único archivo (máximo 4 GB). Prueba sin adjuntos o con «Solo el tablero».", 413);
  }
  return { filename: exportFileName(project.name, now, appTimeZone()), manifest, entries, size, missingFiles };
}

export interface ExportEstimate {
  tasks: number;
  archivedTasks: number;
  releases: number;
  documents: number;
  /** Adjuntos de tareas, releases y documentos, y su tamaño aproximado (según la base de datos). */
  attachments: number;
  bytes: number;
}

/** Recuentos baratos (sin leer ficheros) para enseñar en el diálogo de exportar. */
export async function estimateProjectExport(projectId: string, options: ExportOptions): Promise<ExportEstimate> {
  const all = options.scope === "all";
  const taskWhere: Prisma.TaskWhereInput = { projectId, ...(all ? {} : { archivedAt: null }) };
  const [tasks, archivedTasks, releases, documents, ta, ra, da] = await Promise.all([
    db.task.count({ where: taskWhere }),
    all ? db.task.count({ where: { projectId, archivedAt: { not: null } } }) : 0,
    all ? db.release.count({ where: { projectId } }) : 0,
    db.projectDocument.count({ where: { projectId, deletedAt: null } }),
    options.attachments ? db.taskAttachment.aggregate({ _sum: { size: true }, _count: true, where: { task: taskWhere } }) : null,
    options.attachments && all ? db.releaseAttachment.aggregate({ _sum: { size: true }, _count: true, where: { release: { projectId } } }) : null,
    options.attachments ? db.projectDocument.aggregate({ _sum: { size: true }, _count: true, where: { projectId, deletedAt: null } }) : null,
  ]);
  const parts = [ta, ra, da];
  return {
    tasks, archivedTasks, releases, documents: options.attachments ? documents : 0,
    attachments: parts.reduce((n, p) => n + (p?._count ?? 0), 0),
    bytes: parts.reduce((n, p) => n + (p?._sum.size ?? 0), 0),
  };
}
