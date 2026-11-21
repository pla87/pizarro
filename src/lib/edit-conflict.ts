import "server-only";
import { db } from "./db";
import { EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE, editVersion } from "./edit-conflict-core";
import { AppError } from "./errors";

// Comprobación en el servidor del aviso «Otra persona ha cambiado esto mientras lo editabas» (ver edit-conflict-core.ts).

/**
 * Versión de unos ajustes guardados en AppState: huella de sus valores (no de `updatedAt`), así que guardar lo mismo no
 * cuenta como cambio. Lectura directa (sin las memorias de 30 s): debe ser lo que hay ahora en la base.
 */
export async function appStateVersion(keys: readonly string[], client: Pick<typeof db, "appState"> = db): Promise<string> {
  return appStateRowsVersion(await client.appState.findMany({ where: { key: { in: [...keys] } }, select: { key: true, value: true } }), keys);
}

/** La misma versión, a partir de filas de AppState ya leídas (pueden traer otras claves). */
export function appStateRowsVersion(rows: readonly { key: string; value: string }[], keys: readonly string[]): string {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  // Vacío y sin fila valen lo mismo (algunos ajustes borran la fila al vaciarse y otros guardan "").
  return editVersion(keys.map((k) => byKey.get(k) || null));
}

/** Falla con el aviso si `since` (la versión que se abrió) no es la actual. Sin `since` (otra pestaña de antes, el guardado al cerrar), no comprueba. */
export function assertVersion(since: unknown, current: string): void {
  if (since === undefined || since === null) return;
  if (since !== current) throw new AppError(EDIT_CONFLICT_MESSAGE, 409, EDIT_CONFLICT_CODE);
}
