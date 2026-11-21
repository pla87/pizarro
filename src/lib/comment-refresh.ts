// Refresco en vivo de los comentarios del detalle abierto (TaskComments): el servidor manda solo la primera página (los
// más recientes) y aquí se junta con lo que ya se ve.
import { isBefore, mergeComments } from "@/components/board/comment-list";
import type { CommentInfo } from "./types";

interface CommentList {
  comments: CommentInfo[];
  /** Comentarios anteriores al más antiguo de la lista (los de «Ver anteriores»). */
  olderComments: number;
}

/**
 * Junta la primera página recién leída con la lista que se ve. Desde el más antiguo de la página manda el servidor (así
 * desaparecen los borrados y se ven los editados); lo anterior a ella se conserva tal cual. Si la página no tiene
 * anteriores, es la lista entera. Si no coincide con ningún comentario que ya se viera (llegaron más de una página de
 * golpe), entre ella y lo cargado puede faltar alguno: se queda solo la página, con sus «Ver anteriores».
 * `listed`: ¿el comentario ya llegó en una lista del servidor? (uno propio recién enviado no sirve para saberlo).
 */
export function applyFirstPage(cur: CommentList, page: CommentList, listed: (id: string) => boolean): CommentList {
  const oldest = page.comments[0];
  if (!oldest || page.olderComments === 0) return { comments: page.comments, olderComments: page.olderComments };
  const seen = new Set(cur.comments.filter((c) => listed(c.id)).map((c) => c.id));
  if (!page.comments.some((c) => seen.has(c.id))) return { comments: page.comments, olderComments: page.olderComments };
  const kept = cur.comments.filter((c) => isBefore(c, oldest));
  return { comments: mergeComments(kept, page.comments), olderComments: kept.length ? cur.olderComments : page.olderComments };
}
