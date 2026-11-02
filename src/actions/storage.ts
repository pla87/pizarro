"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeAction } from "@/lib/action-context";
import { runAction } from "@/lib/action";
import { findManageableProject } from "@/lib/access";
import { db } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import { QUOTA_MAX_MB, QUOTA_MIN_MB, type QuotaSetting } from "@/lib/quota";
import { getQuotaSettings, saveQuotaSettings } from "@/lib/quota-settings";
import { requireAdmin, requireUser } from "@/lib/session";
import {
  CLEANUP_DAYS, cleanupArchivedTaskAttachments, cleanupOldReleaseAttachments, deleteDocumentsForever, deleteReleaseAttachments, deleteTaskAttachments,
  emptyDocumentsTrash, invalidateUndoReferencing, previewCleanup, type CleanupKind,
} from "@/lib/storage-cleanup";
import { largestAttachments, projectStorage } from "@/lib/storage-stats";
import * as v from "@/lib/validation";

const mb = z
  .number({ error: "Indica un número." })
  .int("Debe ser un número entero.")
  .min(QUOTA_MIN_MB, "La cuota debe ser de al menos 1 MB.")
  .max(QUOTA_MAX_MB, "La cuota es demasiado grande.");

const settingInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("default") }),
  z.object({ mode: z.literal("unlimited") }),
  z.object({ mode: z.literal("custom"), mb }),
]);

const describe = (s: QuotaSetting, t: "project" | "total"): string =>
  s.mode === "custom" ? `${s.mb} MB` : s.mode === "unlimited" ? "sin límite" : t === "project" ? "la predeterminada (10 GB)" : "sin cuota total";

/** Administración → Ajustes → Almacenamiento: cuotas generales guardadas en la aplicación (las variables de entorno, si existen, mandan). */
export async function saveStorageQuotas(input: { project: QuotaSetting; total: QuotaSetting }) {
  return runAction({ name: "storage.saveQuotas", args: [input] }, async () => {
    await requireAdmin();
    const project = settingInput.parse(input.project) as QuotaSetting;
    // La cuota total no tiene «por defecto» propio: sin valor es sin límite.
    const total = z.union([z.object({ mode: z.literal("custom"), mb }), z.object({ mode: z.literal("default") }), z.object({ mode: z.literal("unlimited") })]).parse(input.total) as QuotaSetting;
    const prev = await getQuotaSettings();
    await saveQuotaSettings({ project, total: total.mode === "unlimited" ? { mode: "default" } : total });
    describeAction("Cambió las cuotas de almacenamiento: por proyecto de {from} a {to}; total del servidor de {fromTotal} a {toTotal}", {
      from: describe(prev.project, "project"), to: describe(project, "project"), fromTotal: describe(prev.total, "total"), toTotal: describe(total, "total"),
    });
    revalidatePath("/admin/settings");
  });
}

/** Cuota propia de un proyecto (MB) o null para usar la general. Solo administradores. */
export async function setProjectStorageQuota(projectId: string, quotaMb: number | null) {
  return runAction({ name: "storage.setProjectQuota", args: [projectId, quotaMb] }, async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw forbidden();
    const project = await findManageableProject(user, projectId);
    const next = quotaMb === null ? null : mb.parse(quotaMb);
    await db.project.update({ where: { id: project.id }, data: { storageQuotaMb: next } });
    describeAction("Cambió la cuota de almacenamiento del proyecto a {value}", { value: next === null ? "la general" : `${next} MB` });
    revalidatePath(`/p/${project.id}/settings`);
  });
}

const kindSchema = z.enum(["archivedTasks", "documentsTrash", "oldReleases"]);

function parseCleanup(kind: string, days: number): { kind: CleanupKind; days: number } {
  const k = kindSchema.parse(kind);
  if (!CLEANUP_DAYS[k].includes(days)) throw new AppError("Antigüedad no válida.");
  return { kind: k, days };
}

/** Cuánto se borraría con una limpieza (solo consulta; alimenta el diálogo de confirmación). */
export async function previewStorageCleanup(projectId: string, kind: string, days: number) {
  return runAction({ name: "storage.previewCleanup", args: [projectId, kind, days] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const c = parseCleanup(kind, days);
    return previewCleanup(project.id, c.kind, c.days);
  });
}

/** Uso del proyecto desglosado y sus 20 ficheros más grandes (para repintar la sección tras una limpieza). */
export async function refreshProjectStorage(projectId: string) {
  return runAction({ name: "storage.largestAttachments", args: [projectId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const [storage, largest] = await Promise.all([projectStorage(project.id), largestAttachments(project.id, 20)]);
    return { storage, largest };
  });
}

/**
 * Borra para siempre (filas, ficheros y miniaturas) un grupo de ficheros del proyecto: adjuntos de tareas archivadas,
 * papelera de documentación o adjuntos de releases antiguas. El cliente pide confirmación mostrando `previewStorageCleanup`.
 */
export async function runStorageCleanup(projectId: string, kind: string, days: number, expectedCount: number) {
  return runAction({ name: "storage.cleanup", args: [projectId, kind, days, expectedCount] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const c = parseCleanup(kind, days);
    const expected = z.number().int().min(0).parse(expectedCount);
    // Se recalcula: si ahora hay más de lo que la persona vio y confirmó, no se borra nada hasta que lo vuelva a confirmar.
    const now = await previewCleanup(project.id, c.kind, c.days);
    if (now.count > expected) throw new AppError("El contenido ha cambiado; revisa y confirma de nuevo.");
    let res: { count: number; bytes: number };
    if (c.kind === "archivedTasks") res = await cleanupArchivedTaskAttachments(project.id, c.days, new Date(), expected);
    else if (c.kind === "oldReleases") res = await cleanupOldReleaseAttachments(project.id, c.days, new Date(), expected);
    else res = await emptyDocumentsTrash(project.id, expected);
    const what = c.kind === "archivedTasks" ? "adjuntos de tareas archivadas" : c.kind === "oldReleases" ? "adjuntos de releases antiguas" : "documentos de la papelera";
    describeAction("Borró definitivamente {n} {what} ({mb} MB liberados)", { n: res.count, what, mb: Math.round((res.bytes / 1024 / 1024) * 10) / 10 }, { kind: c.kind, days: c.days, count: res.count, bytes: res.bytes });
    revalidatePath(`/p/${project.id}/settings`);
    return { count: res.count, bytes: res.bytes };
  });
}

/** Borra para siempre un fichero concreto del proyecto (adjunto de tarea, copia de release o documento). */
export async function deleteStorageItem(projectId: string, kind: string, itemId: string) {
  return runAction({ name: "storage.deleteItem", args: [projectId, kind, itemId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const k = z.enum(["task", "release", "document"]).parse(kind);
    const id = v.id.parse(itemId);
    let res: { count: number; bytes: number };
    if (k === "task") {
      const r = await deleteTaskAttachments(project.id, [id]);
      await invalidateUndoReferencing(project.id, r.ids);
      res = r;
    } else if (k === "release") res = await deleteReleaseAttachments(project.id, [id]);
    else res = await deleteDocumentsForever(project.id, [id]);
    if (res.count === 0) throw new AppError("Ese fichero ya no existe.");
    describeAction("Borró definitivamente un fichero del proyecto ({mb} MB liberados)", { mb: Math.round((res.bytes / 1024 / 1024) * 10) / 10 }, { kind: k, itemId: id, bytes: res.bytes });
    revalidatePath(`/p/${project.id}/settings`);
    return { count: res.count, bytes: res.bytes };
  });
}
