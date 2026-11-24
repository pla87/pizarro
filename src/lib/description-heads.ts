import "server-only";
import { db } from "./db";

// Comienzo de las descripciones para los .ics (suscripción al calendario) y el plan de una columna «Asignación a persona»:
// pueden ser muy largas y allí solo se usa el principio.

/** Lo que se usa de cada descripción: descriptionToPlain (ics.ts) recorta a tantos caracteres antes de convertir. */
export const DESCRIPTION_READ = 1500;

/**
 * Comienzo (`chars` caracteres; por defecto DESCRIPTION_READ) de las descripciones de unas tareas y entregables, sin leer el resto.
 * `substring` deja a PostgreSQL leer solo el principio del valor guardado; las vacías no vienen.
 */
export async function descriptionHeads(taskIds: string[], deliverableIds: string[] = [], chars = DESCRIPTION_READ): Promise<{ tasks: Map<string, string>; deliverables: Map<string, string> }> {
  const [t, d] = await Promise.all([
    taskIds.length
      ? db.$queryRaw<{ id: string; d: string }[]>`SELECT "id", substring("description" from 1 for ${chars}::int) AS "d" FROM "Task" WHERE "id" = ANY(${taskIds}::text[]) AND "description" <> ''`
      : [],
    deliverableIds.length
      ? db.$queryRaw<{ id: string; d: string }[]>`SELECT "id", substring("description" from 1 for ${chars}::int) AS "d" FROM "Deliverable" WHERE "id" = ANY(${deliverableIds}::text[]) AND "description" <> ''`
      : [],
  ]);
  return { tasks: new Map(t.map((r) => [r.id, r.d])), deliverables: new Map(d.map((r) => [r.id, r.d])) };
}
