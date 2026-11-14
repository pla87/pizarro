import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ADMINS_LOCK_NAME } from "./advisory-locks";
import { db } from "./db";
import { AppError, notFound } from "./errors";
import { revokeGoogleToken } from "./google";
import { logEvent } from "./log";
import { notifyProjectsToTeam } from "./notify";
import { purgeProject } from "./project-delete";
import { revokeProject, revokeUser } from "./revoke";
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

/** Proyectos privados en los que la persona es el único miembro. */
const soloPrivateWhere = (userId: string): Prisma.ProjectWhereInput => ({ isPrivate: true, members: { some: { userId }, none: { userId: { not: userId } } } });

/**
 * Proyectos privados en los que la persona es el único miembro, por nombre. Al borrar la cuenta pasan a ser proyectos de
 * equipo (sin miembros: los ven los administradores) salvo que se pida borrarlos también (eraseUser).
 */
export async function soloPrivateProjects(userId: string): Promise<{ id: string; name: string }[]> {
  return db.project.findMany({ where: soloPrivateWhere(userId), orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
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

interface EraseResult {
  /** Proyectos privados de los que era el único miembro y que pasan a ser de equipo. */
  toTeam: { id: string; name: string }[];
  /** Los que se han borrado con la cuenta (pedidos en `deleteProjects`). */
  deleted: { id: string; name: string }[];
}

/**
 * Borra la cuenta. Bajo un candado común (pz:admins) se vuelve a comprobar que no es la última cuenta ni el último
 * administrador activo: dos administradores que se borran a la vez no dejan la instalación sin ninguno. Solo después de
 * esa comprobación, aún con el candado, se descartan su historial de deshacer y sus exportaciones (liberando los
 * ficheros que solo ellos retenían): si la baja no puede seguir, no se ha perdido nada.
 *
 * Proyectos privados de los que es el único miembro: en la misma transacción pasan a ser proyectos de equipo, sin
 * miembros (los ven los administradores, como un proyecto de equipo cuyo único miembro se ha ido); queda anotado en el
 * registro de actividad. Los que vengan en `deleteProjects` (los que se le enseñaron a quien confirma) se borran después,
 * con todo lo que tienen, si siguen privados y sin miembros; si el borrado falla, pasan también a ser de equipo. Los
 * privados con más miembros siguen privados, sin la persona. Los que pasan a ser de equipo se avisan a los demás
 * administradores activos (notifyProjectsToTeam). `self`: lo pide la propia persona (el mensaje va en primera
 * persona). `actor`: quién lo hace, para el registro.
 */
export async function eraseUser(userId: string, opts: { self: boolean; deleteProjects?: readonly string[]; actor?: { id: string; name: string } }): Promise<EraseResult> {
  const wanted = new Set(opts.deleteProjects ?? []);
  const google = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  const { solo, userName } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMINS_LOCK_NAME}))::text`;
    const block = await deletionBlock(userId, tx);
    if (block) throw new AppError(opts.self ? DELETION_BLOCK_MESSAGES[block] : "Debe quedar al menos un administrador activo.");
    // Ya es seguro que se borra (nadie más puede borrar o degradar administradores mientras dure el candado): ahora
    // sí, sus entradas de deshacer y sus exportaciones, que caerían en cascada sin liberar sus ficheros.
    await discardUndo({ userId });
    await discardUserTransfers(userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    const solo = await tx.project.findMany({ where: soloPrivateWhere(userId), orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    const toTeam = solo.filter((p) => !wanted.has(p.id)).map((p) => p.id);
    if (toTeam.length) await tx.project.updateMany({ where: { id: { in: toTeam } }, data: { isPrivate: false, privateOwnerId: null } });
    await tx.taskEvent.updateMany({ where: { userId }, data: { userName: "" } });
    await tx.user.delete({ where: { id: userId } });
    return { solo, userName: user.name };
    // Con muchos ficheros que liberar, el descarte del deshacer puede tardar más que los 5 s por defecto.
  }, { timeout: 120_000 });
  revokeUser(userId);
  // Ya sin la cuenta: que Google retire también el permiso de Drive que había dado.
  if (google) await revokeGoogleToken(google.refreshTokenEnc);
  const result: EraseResult = { toTeam: solo.filter((p) => !wanted.has(p.id)), deleted: [] };
  for (const p of solo.filter((x) => wanted.has(x.id))) {
    // Solo si sigue privado y sin miembros (nadie se ha unido entretanto).
    if (!(await db.project.count({ where: { id: p.id, isPrivate: true, members: { none: {} } } }))) continue;
    try {
      await purgeProject(p.id);
      result.deleted.push(p);
    } catch (err) {
      // La cuenta ya no existe: el fallo se registra en vez de devolver un error que diría que no se ha borrado, y el
      // proyecto pasa a ser de equipo (privado y sin miembros nadie podría verlo).
      console.error("[users] no se pudo borrar un proyecto privado de la cuenta borrada", err);
      logEvent({ level: "error", category: "system", action: "users.privateProjectPurgeFailed", message: "No se pudo borrar un proyecto privado de una cuenta borrada", projectId: p.id, details: { error: err instanceof Error ? err.message : String(err) } });
      const { count } = await db.project.updateMany({ where: { id: p.id, isPrivate: true, members: { none: {} } }, data: { isPrivate: false, privateOwnerId: null } }).catch(() => ({ count: 0 }));
      if (count) result.toTeam.push(p);
    }
  }
  for (const p of result.toTeam) {
    // Han cambiado quién lo ve (ahora, los administradores): fuera las cachés de acceso.
    revokeProject(p.id);
    logEvent({
      category: "action", action: "users.privateProjectToTeam",
      message: `El proyecto privado «${p.name}» pasa a ser de equipo al borrarse la cuenta de «${userName}», su único miembro: ahora lo ven los administradores`,
      userId: opts.actor?.id ?? null, userName: opts.actor?.name ?? null, projectId: p.id, details: { deletedUserId: userId },
    });
  }
  // Aviso en la campana (y por email o mensajería, si lo quieren) a los demás administradores activos, uno por proyecto.
  // Los borrados con la casilla no avisan. La cuenta ya está borrada: un fallo aquí solo se registra.
  if (result.toTeam.length) {
    await notifyProjectsToTeam(result.toTeam, userName, opts.self ? null : opts.actor?.id ?? null).catch((err) => {
      console.error("[users] no se pudo avisar a los administradores", err);
      logEvent({ level: "error", category: "notify", action: "notify.projectToTeamFailed", message: "No se pudo avisar a los administradores de los proyectos que pasan a ser de equipo", details: { error: err instanceof Error ? err.message : String(err), projects: result.toTeam.map((p) => p.id) } });
    });
  }
  return result;
}
