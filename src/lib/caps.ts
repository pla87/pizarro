import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";
import {
  DELIVERABLE_CREATE_PER_MINUTE, LABEL_CREATE_PER_MINUTE, MAX_ACTIVE_TASKS_PER_PROJECT, MAX_DELIVERABLES_PER_PROJECT,
  MAX_LABELS_PER_PROJECT, TASK_CREATE_PER_MINUTE,
} from "./constants";
import { getT } from "@/i18n/server";

type Client = Prisma.TransactionClient | typeof db;

/**
 * Bloquea la fila del proyecto: dos creaciones a la vez no pueden pasarse del tope (solo tiene efecto dentro de una transacción).
 * FOR NO KEY UPDATE: se serializa con los demás bloqueos sin frenar las altas de tareas que solo referencian el proyecto.
 */
export async function lockProject(client: Client, projectId: string) {
  await client.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`;
}

/**
 * Comprueba que el proyecto admite `adding` tareas activas más (las archivadas no cuentan).
 * Pásale el cliente de la transacción en la que se va a crear para que el recuento y la creación sean atómicos.
 */
export async function assertTaskCapacity(client: Client, projectId: string, adding = 1): Promise<void> {
  if (adding <= 0) return;
  await lockProject(client, projectId);
  const active = await client.task.count({ where: { projectId, archivedAt: null } });
  if (active + adding <= MAX_ACTIVE_TASKS_PER_PROJECT) return;
  if (adding === 1) throw new AppError("Este proyecto ya tiene el máximo de 1000 tareas activas. Archiva o borra alguna.");
  const t = await getT();
  throw new AppError(t("Este proyecto tiene {active} de 1000 tareas activas: no caben {adding} más. Archiva o borra alguna.", { active, adding }));
}

/** ¿Cabe una tarea activa más? (para la repetición automática, que no debe fallar al mover la tarjeta). */
export async function hasTaskCapacity(client: Client, projectId: string): Promise<boolean> {
  return (await client.task.count({ where: { projectId, archivedAt: null } })) < MAX_ACTIVE_TASKS_PER_PROJECT;
}

export async function assertLabelCapacity(client: Client, projectId: string): Promise<void> {
  await lockProject(client, projectId);
  if ((await client.label.count({ where: { projectId } })) >= MAX_LABELS_PER_PROJECT) {
    throw new AppError("Este proyecto ya tiene el máximo de 50 etiquetas. Borra alguna.");
  }
}

export async function assertDeliverableCapacity(client: Client, projectId: string): Promise<void> {
  await lockProject(client, projectId);
  if ((await client.deliverable.count({ where: { projectId } })) >= MAX_DELIVERABLES_PER_PROJECT) {
    throw new AppError("Este proyecto ya tiene el máximo de 100 entregables. Borra alguno.");
  }
}

/** Ritmo de creación por persona (las tareas cuentan una por unidad). */
export function assertTaskCreateRate(userId: string, count = 1): void {
  if (!rateLimit(`create-task:${userId}`, TASK_CREATE_PER_MINUTE, 60_000, count)) throw new AppError("Demasiadas tareas creadas seguidas. Espera un minuto.");
}
export function assertLabelCreateRate(userId: string): void {
  if (!rateLimit(`create-label:${userId}`, LABEL_CREATE_PER_MINUTE, 60_000)) throw new AppError("Demasiadas etiquetas creadas seguidas. Espera un minuto.");
}
export function assertDeliverableCreateRate(userId: string): void {
  if (!rateLimit(`create-deliverable:${userId}`, DELIVERABLE_CREATE_PER_MINUTE, 60_000)) throw new AppError("Demasiados entregables creados seguidos. Espera un minuto.");
}
