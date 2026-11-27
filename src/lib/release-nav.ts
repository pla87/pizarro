import "server-only";
import { cache } from "react";
import { db } from "./db";

/**
 * ¿Usa releases el proyecto? (columna «Siguiente salto» o alguna release hecha). Lo piden el layout (el enlace «Releases»
 * del menú) y la página del tablero en la misma petición: con `cache`, una sola ida a la base para los dos. Sin comprobar
 * el acceso: quien lo llama solo usa el resultado de un proyecto que la persona ve.
 */
export const releaseUse = cache(async (projectId: string): Promise<{ column: boolean; release: boolean }> => {
  const [column, release] = await Promise.all([
    db.column.findFirst({ where: { projectId, role: "NEXT_RELEASE" }, select: { id: true } }),
    db.release.findFirst({ where: { projectId }, select: { id: true } }),
  ]);
  return { column: !!column, release: !!release };
});
