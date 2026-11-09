// Candado de los tipos de tarea (fuera de los ficheros "use server" para que no se exponga como acción).
import type { Prisma } from "@/generated/prisma/client";

/**
 * Candado de los tipos de un ámbito hasta el final de la transacción: recuento, nombre único y alta (o renombrado) van
 * juntos, y dos peticiones a la vez no pueden pasarse del tope ni repetir nombre. Un tipo general no puede repetir el
 * nombre de ningún tipo de ningún proyecto: toma el candado general en exclusiva. Uno de proyecto toma el de su proyecto
 * en exclusiva y el general compartido (así los de proyectos distintos no se esperan entre sí). Siempre en el mismo orden.
 * También lo toma quien oculta un tipo general en un proyecto (project-kinds.ts), para que dos a la vez no lo dejen sin tipos.
 */
export async function lockKindScope(tx: Prisma.TransactionClient, projectId: string | null): Promise<void> {
  if (projectId === null) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:kinds:general'))::text`;
    return;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('pz:kinds:general'))::text`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pz:kinds:${projectId}`}))::text`;
}
