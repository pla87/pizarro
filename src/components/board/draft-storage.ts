// Almacenamiento de los borradores locales (localStorage, `pz-draft-*`), sin React: lo usan drafts.ts (tareas nuevas
// y en edición) y la caja de comentarios. Cada entrada guarda { at, value } y caduca a los 7 días (los comentarios, al día).

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Borra todos los borradores locales (`pz-draft-*`); las preferencias de filtros del tablero se conservan. */
export function clearAllDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("pz-draft-")) localStorage.removeItem(key);
  } catch {
    // Sin acceso a localStorage no hay borradores que borrar.
  }
}

/** Lee un borrador; si tiene más de `maxAgeMs` (o la fecha es ilegible) lo borra y devuelve null. */
export function readDraft<T>(key: string, maxAgeMs = MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    if (!(Date.now() - at <= maxAgeMs)) {
      localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** Guarda un borrador con la hora actual (null lo borra). */
export function writeDraft(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Sin almacenamiento (modo privado, cuota): no hay borrador.
  }
}

/**
 * Lo que hay que borrar al cerrar sesión: los borradores de comentarios siempre (pueden contener menciones y texto
 * a medio escribir de una tarea ajena, y son de un día); el resto de borradores, solo si la persona lo pidió en su perfil.
 */
export function clearDraftsOnLogout(all: boolean): void {
  if (all) return clearAllDrafts();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(COMMENT_PREFIX)) localStorage.removeItem(key);
  } catch {
    // Sin acceso a localStorage no hay borradores que borrar.
  }
}

export function clearDraft(key: string): void {
  writeDraft(key, null);
}

// --- Borradores de comentarios -------------------------------------------------------
// Lo escrito en la caja de comentario (y a quién se responde) se guarda en el navegador al momento, por usuario y
// tarea: cerrar el detalle, recargar o un error al enviar no lo pierden. Caducan al día; enviar o vaciar la caja los borra.

const COMMENT_PREFIX = "pz-draft-comment:";
export const COMMENT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CommentDraft {
  /** Texto en formato guardado (con las menciones como @[Nombre](user:ID)). */
  text: string;
  /** Comentario al que se respondía (lo justo para pintar «Respondiendo a…»). */
  replyTo?: { id: string; authorName: string | null; body: string } | null;
}

export const commentDraftKey = (userId: string, taskId: string) => `${COMMENT_PREFIX}${userId}:${taskId}`;

export function readCommentDraft(userId: string, taskId: string): CommentDraft | null {
  const value = readDraft<CommentDraft>(commentDraftKey(userId, taskId), COMMENT_DRAFT_MAX_AGE_MS);
  if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
  const r = value.replyTo;
  const replyTo = r && typeof r.id === "string" && typeof r.body === "string" ? { id: r.id, authorName: typeof r.authorName === "string" ? r.authorName : null, body: r.body } : null;
  return { text: value.text, replyTo };
}

/** Guarda el borrador; sin texto (caja vacía o solo espacios) lo borra. */
export function saveCommentDraft(userId: string, taskId: string, draft: CommentDraft | null): void {
  const key = commentDraftKey(userId, taskId);
  if (!draft || !draft.text.trim()) return clearDraft(key);
  const replyTo = draft.replyTo ? { id: draft.replyTo.id, authorName: draft.replyTo.authorName, body: draft.replyTo.body.slice(0, 200) } : null;
  writeDraft(key, { text: draft.text, replyTo });
}

/** Borra los borradores de comentario caducados (o ilegibles) de todas las tareas. */
export function purgeExpiredCommentDrafts(now = Date.now()): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(COMMENT_PREFIX)) continue;
      let at: unknown = null;
      try {
        at = (JSON.parse(localStorage.getItem(key) ?? "") as { at?: unknown }).at;
      } catch {
        // Ilegible: se borra.
      }
      if (typeof at !== "number" || !(now - at <= COMMENT_DRAFT_MAX_AGE_MS)) localStorage.removeItem(key);
    }
  } catch {
    // Sin acceso a localStorage no hay nada que limpiar.
  }
}
