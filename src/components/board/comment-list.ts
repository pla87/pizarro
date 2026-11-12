// Lista de comentarios del detalle abierto: orden, fusión sin repetidos y cursor del refresco en vivo (ver TaskComments).
import type { CommentInfo } from "@/lib/types";

export type CommentCursor = { createdAt: string; id: string };
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

/**
 * Desde dónde se piden los comentarios al refrescar: el más antiguo de los que ya llegaron en una lista del servidor
 * (todo lo posterior a él se pide de nuevo: nuevos, editados y borrados). Los propios recién enviados no valen como
 * cursor: otra persona pudo comentar justo antes y su comentario, anterior al nuestro, quedaría fuera (salía luego como
 * «Ver anteriores»). Sin ninguno, null: la primera página.
 */
export function refreshCursor(comments: CommentInfo[], unlisted: ReadonlySet<string>): CommentCursor | null {
  const first = comments.find((c) => !unlisted.has(c.id));
  return first ? { createdAt: first.createdAt, id: first.id } : null;
}
