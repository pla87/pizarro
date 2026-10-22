// Quién sigue una tarea. Funciones puras (sin BD) para poder testearlas.
//
// Se sigue una tarea implícitamente si la creaste o la tienes asignada; al comentar o ser mencionado
// se guarda además una fila en TaskFollower. Una fila con `muted` (dejar de seguir) gana siempre al
// seguimiento implícito, y una sin `muted` (seguir) sirve aunque no se cumpla ninguna condición.

export interface FollowInput {
  createdById: string | null;
  assigneeId: string | null;
  rows: { userId: string; muted: boolean }[];
}

/** ¿Este usuario sigue la tarea? */
export function isFollowing(userId: string, task: FollowInput): boolean {
  const row = task.rows.find((r) => r.userId === userId);
  if (row) return !row.muted;
  return task.createdById === userId || task.assigneeId === userId;
}

/** Ids de quienes siguen la tarea, sin los excluidos (el autor del cambio, quien ya recibe otro aviso…). */
export function followerIds(task: FollowInput, exclude: Iterable<string> = []): string[] {
  const skip = new Set(exclude);
  const candidates = new Set<string>();
  if (task.createdById) candidates.add(task.createdById);
  if (task.assigneeId) candidates.add(task.assigneeId);
  for (const r of task.rows) candidates.add(r.userId);
  return [...candidates].filter((id) => !skip.has(id) && isFollowing(id, task));
}
