import "server-only";
import { forgetProjectAccess, forgetUserAccess } from "./access-cache";
import { forgetProjectAttachments } from "./attachment-cache";
import { dropProjectPresence, dropUserPresence, leavePresence } from "./presence";
import { revokeProjectStreams, revokeSessionStreams, revokeUserStreams } from "./realtime";

// Puntos de entrada para cortar conexiones en vivo (SSE y presencia) cuando cambia el acceso. Llamar tras confirmar
// el cambio en BD. También vacían la caché de acceso (access-cache.ts). No invalidan sesiones: una sesión deja de valer cuando se borra su fila (cierre de sesión,
// desactivación, cambio de rol o de contraseña); esto solo corta lo que ya estaba abierto.

/** El usuario ya no debe tener nada abierto: desactivado, rol cambiado, sesiones borradas o usuario borrado. */
export function revokeUser(userId: string): void {
  forgetUserAccess(userId);
  revokeUserStreams(userId);
  dropUserPresence(userId);
}

/**
 * Una sesión concreta ha terminado. Con `loggedOut` (la persona ha cerrado sesión con «Cerrar sesión»), además deja de
 * contar entre los activos al momento, como en las demás revocaciones (salvo donde tenga abierto otro canal).
 */
export function revokeSession(sessionId: string, loggedOut?: { userId: string }): void {
  revokeSessionStreams(sessionId);
  if (loggedOut) leavePresence(loggedOut.userId);
}

/** Han cambiado quién ve el proyecto (visibilidad o miembros) o se ha borrado. */
export function revokeProject(projectId: string): void {
  forgetProjectAccess(projectId);
  forgetProjectAttachments(projectId);
  revokeProjectStreams(projectId);
  dropProjectPresence(projectId);
}
