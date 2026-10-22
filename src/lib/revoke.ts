import "server-only";
import { dropProjectPresence, dropUserPresence } from "./presence";
import { revokeProjectStreams, revokeSessionStreams, revokeUserStreams } from "./realtime";

// Puntos de entrada para cortar conexiones en vivo cuando cambia el acceso. Llamar tras confirmar el cambio en BD.

/** El usuario ya no debe tener nada abierto: desactivado, rol cambiado, sesiones borradas o usuario borrado. */
export function revokeUser(userId: string): void {
  revokeUserStreams(userId);
  dropUserPresence(userId);
}

/** Una sesión concreta ha terminado (cierre de sesión). */
export function revokeSession(sessionId: string): void {
  revokeSessionStreams(sessionId);
}

/** Han cambiado quién ve el proyecto (visibilidad o miembros) o se ha borrado. */
export function revokeProject(projectId: string): void {
  revokeProjectStreams(projectId);
  dropProjectPresence(projectId);
}
