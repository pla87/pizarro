/**
 * Último tipo con el que cada persona creó una tarea en cada proyecto: «Nueva tarea» lo preselecciona (en lugar del primer
 * tipo de la lista). Se guarda en el navegador (localStorage, por persona y proyecto): es una comodidad de ese
 * dispositivo, no hace falta en el servidor. Sin localStorage (navegación privada, bloqueado) se usa el primer tipo.
 */
const lastKindKey = (userId: string, projectId: string) => `pz-last-kind:${userId}:${projectId}`;

/** Tipo con el que abrir «Nueva tarea»: el último usado si sigue entre los visibles del proyecto; si no, el primero. */
export function initialKindId(userId: string, projectId: string, kinds: readonly { id: string }[]): string {
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(lastKindKey(userId, projectId));
  } catch {
    // Sin almacenamiento: el primero.
  }
  return (last && kinds.some((k) => k.id === last) ? last : kinds[0]?.id) ?? "";
}

/** Anota el tipo de la tarea recién creada en ese proyecto. */
export function rememberKind(userId: string, projectId: string, kindId: string): void {
  if (!kindId) return;
  try {
    window.localStorage.setItem(lastKindKey(userId, projectId), kindId);
  } catch {
    // Sin almacenamiento: no se recuerda.
  }
}
