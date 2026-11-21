// Lista de comentarios del detalle abierto: orden y fusión sin repetidos (ver TaskComments; el refresco, comment-refresh.ts).
import type { CommentInfo } from "@/lib/types";

type CommentCursor = { createdAt: string; id: string };
/** ¿`c` va antes que `ref` en el orden de los comentarios (fecha y, a igual fecha, id)? */
export const isBefore = (c: CommentCursor, ref: CommentCursor) => c.createdAt < ref.createdAt || (c.createdAt === ref.createdAt && c.id < ref.id);

/**
 * Junta listas de comentarios en el orden del servidor (fecha y, a igual fecha, id), sin repetidos: de un mismo
 * comentario gana la última versión de la lista. Así un comentario propio recién enviado no queda detrás de otros
 * anteriores que llegan después, ni sale dos veces.
 */
export function mergeComments(...lists: CommentInfo[][]): CommentInfo[] {
  const byId = new Map<string, CommentInfo>();
  for (const list of lists) for (const c of list) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => (isBefore(a, b) ? -1 : isBefore(b, a) ? 1 : 0));
}
