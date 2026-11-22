// Límites de «Informar de un error o enviar una sugerencia» por email (FEEDBACK_LIMITS: 5 al día por persona y 20 por
// instalación). En el limitador en memoria de las demás rutas: un reinicio los pone a cero, lo que basta para frenar un
// bucle o un abuso. Solo gastan los envíos que salen: la reserva se devuelve si algo falla antes o al enviar.
import { FEEDBACK_LIMITS } from "./feedback-core";
import { rateLimit, rateLimitReached, releaseRateLimit } from "./rate-limit";

const keys = (userId: string) => ({ user: `feedback:user:${userId}`, install: "feedback:install" });

/** Reserva un envío para esta persona; devuelve el motivo si ya no quedan (y entonces no gasta ninguno). */
export function reserveFeedback(userId: string): "rate_user" | "rate_install" | null {
  const k = keys(userId);
  if (rateLimitReached(k.user, FEEDBACK_LIMITS.user)) return "rate_user";
  if (rateLimitReached(k.install, FEEDBACK_LIMITS.install)) return "rate_install";
  rateLimit(k.user, FEEDBACK_LIMITS.user, FEEDBACK_LIMITS.windowMs);
  rateLimit(k.install, FEEDBACK_LIMITS.install, FEEDBACK_LIMITS.windowMs);
  return null;
}

/** Devuelve la reserva de un envío que no ha salido. */
export function releaseFeedback(userId: string): void {
  const k = keys(userId);
  releaseRateLimit(k.user);
  releaseRateLimit(k.install);
}
