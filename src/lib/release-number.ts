import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

// Numeración de las releases de un proyecto. La siguiente es la mayor de las que hay más uno, pero también por encima
// de la mayor que se borró del histórico: las tareas de una release borrada conservan su código («R12F1: …») y la
// siguiente no debe repetir ese número. Deshacer un despliegue sí lo libera (devuelve los títulos sin el código).
// Se guarda en AppState (`release-number:<proyecto>`), sin columna nueva; se borra con el proyecto.

type Client = Prisma.TransactionClient | typeof db;

const floorKey = (projectId: string) => `release-number:${projectId}`;

/** Número de la siguiente release del proyecto. Dentro del despliegue, con el proyecto bloqueado (lockProject). */
export async function nextReleaseNumber(client: Client, projectId: string): Promise<number> {
  // En fila, no con Promise.all: dentro de una transacción comparten conexión (ver HANDOFF, aviso de pg).
  const last = await client.release.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
  const floor = await client.appState.findUnique({ where: { key: floorKey(projectId) }, select: { value: true } });
  const deleted = Number(floor?.value);
  return Math.max(last?.number ?? 0, Number.isInteger(deleted) ? deleted : 0) + 1;
}

/** Al borrar una release del histórico: su número ya no se reutiliza. Con el proyecto bloqueado, en la misma transacción. */
export async function retireReleaseNumber(tx: Prisma.TransactionClient, projectId: string, number: number): Promise<void> {
  const key = floorKey(projectId);
  const prev = Number((await tx.appState.findUnique({ where: { key }, select: { value: true } }))?.value);
  if (Number.isInteger(prev) && prev >= number) return;
  await tx.appState.upsert({ where: { key }, create: { key, value: String(number) }, update: { value: String(number) } });
}

/** Al borrar el proyecto. */
export async function forgetReleaseNumbers(projectId: string): Promise<void> {
  await db.appState.deleteMany({ where: { key: floorKey(projectId) } });
}
