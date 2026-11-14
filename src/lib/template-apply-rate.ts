// Límites de «Aplicar plantilla»: aplicar y deshacer son transacciones largas que bloquean las columnas, los tipos y la
// fila del proyecto (nadie puede mover tareas ni crear columnas mientras duran), así que se limitan por proyecto y por
// persona. La vista previa solo lee, con un límite más alto. Usa el limitador en memoria de las demás acciones.
import { rateLimit, rateLimitReached, rateLimitRetryAfterSec, releaseRateLimit } from "./rate-limit";

/**
 * - Por proyecto: 5 cambios (aplicar o deshacer) cada 10 minutos. Da para probar una plantilla, deshacerla y probar otra
 *   dos veces seguidas; más que eso en un mismo proyecto es un bucle o un abuso, y cada uno bloquea el tablero.
 * - Por persona: 20 cambios por hora en todos sus proyectos (quien prepara varios proyectos a la vez no se queda corto).
 * - Vista previa: 60 cada 10 minutos por persona (una por plantilla que se mira; no bloquea nada).
 */
export const TEMPLATE_CHANGE_LIMITS = {
  project: { limit: 5, windowMs: 10 * 60_000 },
  user: { limit: 20, windowMs: 60 * 60_000 },
  preview: { limit: 60, windowMs: 10 * 60_000 },
} as const;

/** Aviso traducible (clave en español y sus variables). */
interface RateNotice {
  text: string;
  vars: Record<string, number>;
}

const keys = (userId: string, projectId: string) => ({ project: `template-change:project:${projectId}`, user: `template-change:user:${userId}` });
const minutes = (key: string) => Math.max(1, Math.ceil(rateLimitRetryAfterSec(key) / 60));

/**
 * Reserva un cambio de plantilla (aplicar o deshacer) para esta persona y este proyecto. Devuelve el aviso si ya no
 * quedan; si no, lo cuenta en los dos contadores (solo si caben los dos: un rechazo no gasta ninguno).
 */
export function reserveTemplateChange(userId: string, projectId: string): RateNotice | null {
  const k = keys(userId, projectId);
  const { project, user } = TEMPLATE_CHANGE_LIMITS;
  if (rateLimitReached(k.project, project.limit)) {
    return { text: "Este proyecto ya ha cambiado de plantilla {n} veces en los últimos {w} minutos. Vuelve a intentarlo dentro de {min} min.", vars: { n: project.limit, w: project.windowMs / 60_000, min: minutes(k.project) } };
  }
  if (rateLimitReached(k.user, user.limit)) {
    return { text: "Ya has aplicado o deshecho {n} plantillas en la última hora. Vuelve a intentarlo dentro de {min} min.", vars: { n: user.limit, min: minutes(k.user) } };
  }
  rateLimit(k.project, project.limit, project.windowMs);
  rateLimit(k.user, user.limit, user.windowMs);
  return null;
}

/** Devuelve la reserva de un cambio que no se hizo (p. ej. la plantilla no cabe o no hay nada que deshacer). */
export function releaseTemplateChange(userId: string, projectId: string): void {
  const k = keys(userId, projectId);
  releaseRateLimit(k.project);
  releaseRateLimit(k.user);
}

// Errores de un cambio que ya se había ejecutado dentro de su transacción cuando falló (y se deshizo entero): p. ej. una
// columna «Programa del curso» que queda por encima del tope al final, o datos cambiados entre medias. Ese trabajo (con
// el tablero bloqueado) ya se ha hecho, así que su reserva no se devuelve aunque el error sea un aviso: si se devolviera,
// repetir un cambio que siempre falla al final esquivaría el límite y bloquearía el proyecto una y otra vez.
const spent = new WeakSet<object>();

/** Marca el error de un cambio que ya llegó a ejecutarse: su reserva se queda gastada (ver shouldReleaseTemplateChange). */
export function markTemplateChangeSpent<E>(err: E): E {
  if (err && typeof err === "object") spent.add(err);
  return err;
}

/** ¿Se devuelve la reserva tras este error? Solo con un aviso (`isNotice`) anterior al cambio, no con uno marcado. */
export function shouldReleaseTemplateChange(err: unknown, isNotice: boolean): boolean {
  return isNotice && !(err && typeof err === "object" && spent.has(err));
}

/** Cuenta una vista previa; devuelve el aviso si ya no quedan. */
export function reserveTemplatePreview(userId: string): RateNotice | null {
  const key = `template-preview:${userId}`;
  const { limit, windowMs } = TEMPLATE_CHANGE_LIMITS.preview;
  if (rateLimit(key, limit, windowMs)) return null;
  return { text: "Demasiadas vistas previas de plantillas seguidas. Vuelve a intentarlo dentro de {min} min.", vars: { min: minutes(key) } };
}
