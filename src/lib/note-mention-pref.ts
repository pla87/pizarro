// Email de las menciones en notas de Documentación (Mi perfil → Avisos, v1.77): al momento, en el resumen diario o no.
// Sin base de datos: lo usan el servidor (envío, resumen, baja) y el formulario del perfil.

export const NOTE_MENTION_EMAIL_MODES = ["NOW", "DIGEST", "OFF"] as const;
export type NoteMentionEmailMode = (typeof NOTE_MENTION_EMAIL_MODES)[number];

export const isNoteMentionEmailMode = (v: unknown): v is NoteMentionEmailMode => NOTE_MENTION_EMAIL_MODES.includes(v as NoteMentionEmailMode);

/**
 * Lo que vale la opción para esta persona. Mientras no la elija (null, o un valor que esta versión no conoce), sigue a
 * sus otras opciones de email: si tiene el resumen diario, en el resumen (no añade emails sueltos a quien ya pidió
 * recibirlo todo junto); si no, como sus menciones en tareas («Email cuando me mencionan»): al momento o no.
 */
export function noteMentionEmailMode(u: { noteMentionEmail: string | null; notifyEmail: boolean; dailyDigest: boolean }): NoteMentionEmailMode {
  if (isNoteMentionEmailMode(u.noteMentionEmail)) return u.noteMentionEmail;
  return u.dailyDigest ? "DIGEST" : u.notifyEmail ? "NOW" : "OFF";
}
