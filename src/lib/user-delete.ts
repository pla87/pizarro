import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ADMINS_LOCK_NAME } from "./advisory-locks";
import { db } from "./db";
import { AppError, notFound } from "./errors";
import { revokeGoogleToken } from "./google";
import { logEvent } from "./log";
import { purgeProject } from "./project-delete";
import { revokeUser } from "./revoke";
import { discardUserTransfers } from "./transfer-jobs";
import { discardUndo } from "./undo";
import { DELETION_BLOCK_MESSAGES, deletionBlockFor, type DeletionBlock } from "./user-delete-core";

// Borrado de una cuenta, el mismo para «Administración → Usuarios» y para «Mi perfil → Borrar mi cuenta».
//
// Lo que es de la persona cae con su fila (claves ajenas en cascada): sesiones, dispositivos recordados, códigos de
// recuperación, desafíos, enlaces pendientes, avisos que recibe y pendientes de enviar, seguimientos, plantillas,
// suscripción al calendario, Telegram y WhatsApp, conexión con Google, membresías y elecciones de proyectos.
// Lo que creó en proyectos compartidos se conserva sin autor (SetNull): tareas, comentarios, adjuntos, enlaces,
// documentos y releases; la pantalla lo muestra como «Usuario eliminado». El historial de las tareas guarda el nombre
// en texto (TaskEvent.userName): se vacía aquí y también se muestra como «Usuario eliminado».

/** Proyectos privados en los que la persona es el único miembro: se borran con su cuenta. */
export async function soloPrivateProjectIds(userId: string): Promise<string[]> {
  const rows = await db.project.findMany({
    where: { isPrivate: true, members: { some: { userId }, none: { userId: { not: userId } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** ¿Se puede borrar esta cuenta? null si sí. */
export async function deletionBlock(userId: string, client: Prisma.TransactionClient | typeof db = db): Promise<DeletionBlock | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user) throw notFound();
  // En fila: dentro de una transacción interactiva no se lanzan consultas a la vez (ver HANDOFF, aviso de pg).
  const users = await client.user.count({ where: { id: { not: userId } } });
  const activeAdmins = await client.user.count({ where: { id: { not: userId }, role: "ADMIN", active: true } });
  return deletionBlockFor(user, { users, activeAdmins });
}

/**
 * Borra la cuenta y, después, sus proyectos privados sin más miembros (`privates`, de soloPrivateProjectIds; quien
 * llama pide antes la confirmación). Bajo un candado común se vuelve a comprobar que no es la última cuenta ni el último
 * administrador activo: dos administradores que se borran a la vez no dejan la instalación sin ninguno. `self`: lo pide
 * la propia persona (el mensaje va en primera persona).
 */
export async function eraseUser(userId: string, privates: string[], opts: { self: boolean }): Promise<void> {
  // Antes que nada: libera los ficheros que solo retenía su historial de deshacer, y sus exportaciones.
  await discardUndo({ userId });
  await discardUserTransfers(userId);
  const google = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMINS_LOCK_NAME}))::text`;
    const block = await deletionBlock(userId, tx);
    if (block) throw new AppError(opts.self ? DELETION_BLOCK_MESSAGES[block] : "Debe quedar al menos un administrador activo.");
    await tx.taskEvent.updateMany({ where: { userId }, data: { userName: "" } });
    await tx.user.delete({ where: { id: userId } });
  });
  revokeUser(userId);
  // Ya sin la cuenta: que Google retire también el permiso de Drive que había dado.
  if (google) await revokeGoogleToken(google.refreshTokenEnc);
  // Solo los que siguen sin miembros (nadie se ha unido entretanto).
  const orphans = privates.length
    ? await db.project.findMany({ where: { id: { in: privates }, isPrivate: true, members: { none: {} } }, select: { id: true } })
    : [];
  for (const p of orphans) {
    try {
      await purgeProject(p.id);
    } catch (err) {
      // La cuenta ya no existe: el fallo se registra en vez de devolver un error que diría que no se ha borrado.
      console.error("[users] no se pudo borrar un proyecto privado de la cuenta borrada", err);
      logEvent({ level: "error", category: "system", action: "users.privateProjectPurgeFailed", message: "No se pudo borrar un proyecto privado de una cuenta borrada", projectId: p.id, details: { error: err instanceof Error ? err.message : String(err) } });
    }
  }
}
