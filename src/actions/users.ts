"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { tasksN } from "@/lib/undo-label";
import { AppError, notFound } from "@/lib/errors";
import { MAX_USERS } from "@/lib/limits";
import { randomBytes } from "node:crypto";
import { sendEmailChangedMail, sendGoogleUnlinkedMail, sendInviteMail, sendPasswordResetMail, sendProjectInviteMail, sendTwoFactorChangedMail } from "@/lib/auth-mail";
import { findManageableProject } from "@/lib/access";
import { inviteProjectId, nameFromEmail } from "@/lib/project-invite";
import { issueAuthToken } from "@/lib/auth-token";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { logMailError } from "@/lib/mask-email";
import { hashPassword, passwordSchema } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { retargetReportSchedules } from "@/lib/report-recipient";
import { eraseUser } from "@/lib/user-delete";
import { HAS_ENTERED, invitePendingFrom } from "@/lib/user-entered";
import { disconnectGoogleAccount } from "@/lib/google";
import { ADMINS_LOCK_NAME } from "@/lib/advisory-locks";
import { requireAdmin } from "@/lib/session";
import { clearTwoFactor } from "@/lib/two-factor";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";
import { getInstanceSettings } from "@/lib/instance";
import { revokeUser } from "@/lib/revoke";
import { publishChange } from "@/lib/realtime";

const createSchema = z.object({
  name: v.name,
  email: v.email,
  /** Solo se pide sin email configurado; con email, la persona elige la suya desde la invitación. */
  password: z.string().max(200).optional(),
  role: z.enum(["ADMIN", "MEMBER"]),
  /** Idioma de su interfaz y de la invitación; sin indicar, el de la instalación. */
  locale: z.enum(["ES", "EN"]).optional(),
});

/**
 * Alta de usuario. Con email configurado se envía una invitación (72 h) para que elija su contraseña;
 * sin email, el admin escribe una clave inicial y la persona está obligada a cambiarla al entrar.
 * En ningún caso el admin llega a conocer la contraseña definitiva.
 */
/**
 * Lanza si ya hay MAX_USERS usuarios activos. Dentro de una transacción toma antes un candado común a altas y
 * reactivaciones (pg_advisory_xact_lock), para que dos a la vez no puedan pasarse del tope.
 */
async function assertUserSlot(client: Prisma.TransactionClient | typeof db): Promise<void> {
  if (client !== db) await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:max-users'))::text`;
  if ((await client.user.count({ where: { active: true } })) >= MAX_USERS) {
    const t = await getT();
    throw new AppError(t("Se ha alcanzado el máximo de {n} usuarios activos.", { n: MAX_USERS }));
  }
}

export async function createUser(input: z.input<typeof createSchema>) {
  return runAction({ name: "users.createUser", args: [{ name: input.name, email: input.email, role: input.role, locale: input.locale }] }, async () => {
    const admin = await requireAdmin();
    const data = createSchema.parse(input);
    const invite = emailEnabled();
    const initial = invite ? null : passwordSchema("La contraseña debe tener al menos 10 caracteres.").parse(data.password ?? "");
    const created = await insertUser(data, initial);
    revalidatePath("/admin/users");
    if (!invite) return { invited: false };
    try {
      const token = await issueAuthToken(created.id, "INVITE");
      await sendInviteMail(created, `${appUrl()}/reset/${token}`, admin.name);
    } catch (err) {
      logMailError("[users] invitación", err);
      throw new AppError("Usuario creado, pero no se pudo enviar la invitación. Revisa el envío de emails y pulsa «Reenviar invitación» en su fila.");
    }
    return { invited: true };
  });
}

/**
 * Alta común de «Nuevo usuario» y de «Invitar por email» (un proyecto): tope de usuarios activos, email libre y
 * contraseña inicial (sin ella, una aleatoria que nadie conoce). Con `projectId`, la cuenta entra ya en ese proyecto.
 */
async function insertUser(data: { name: string; email: string; role: "ADMIN" | "MEMBER"; locale?: "ES" | "EN" }, initial: string | null, projectId?: string) {
  const locale = data.locale ?? ((await getInstanceSettings()).locale === "en" ? "EN" : "ES");
  await assertUserSlot(db);
  if (await db.user.count({ where: { email: data.email } })) throw new AppError("Ya existe un usuario con ese email.");
  // Con invitación la contraseña provisional es aleatoria y nadie la conoce.
  const passwordHash = await hashPassword(initial ?? randomBytes(32).toString("base64url"));
  // El recuento se repite dentro de la transacción, con el candado: dos altas a la vez no pasan del tope.
  return db.$transaction(async (tx) => {
    await assertUserSlot(tx);
    const user = await tx.user.create({
      data: { name: data.name, email: data.email, role: data.role, locale, mustChangePassword: true, passwordHash },
      select: { id: true, name: true, email: true, locale: true },
    });
    if (projectId) await tx.projectMember.create({ data: { projectId, userId: user.id } });
    return user;
  });
}

/**
 * «Invitar por email» en los miembros de un proyecto (solo administradores, que son quienes crean cuentas): da de alta a
 * una persona sin cuenta como invitación (enlace de un solo uso, 72 h, para elegir su contraseña), la añade al proyecto y,
 * al elegir la contraseña, la lleva a su tablero (el enlace guarda el proyecto). Con email configurado se le envía; con o
 * sin email, se devuelve el enlace para «Copiar enlace». El nombre sale del email; la persona lo cambia en su perfil.
 */
export async function inviteToProject(projectId: string, email: string) {
  return runAction({ name: "users.inviteToProject", args: [projectId] }, async () => {
    const admin = await requireAdmin();
    const project = await findManageableProject(admin, projectId);
    if (!rateLimit(`project-invite:${admin.id}`, 20, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const address = v.email.parse(email);
    if (await db.user.count({ where: { email: address } })) throw new AppError("Ya hay una cuenta con ese email: añádela con «Añadir miembro…».");
    const created = await insertUser({ name: v.name.parse(nameFromEmail(address)), email: address, role: "MEMBER" }, null, project.id);
    const token = await issueAuthToken(created.id, "INVITE", { projectId: project.id });
    const link = `${appUrl()}/reset/${token}`;
    let emailed = false;
    let mailFailed = false;
    if (emailEnabled()) {
      try {
        await sendProjectInviteMail(created, link, admin.name, project.name);
        emailed = true;
      } catch (err) {
        logMailError("[users] invitación a un proyecto", err);
        mailFailed = true;
      }
    }
    // El enlace no se registra: solo quién, a qué proyecto y por dónde.
    describeAction(`Invitó a «${created.name}» al proyecto ${project.isPrivate ? "privado " : ""}«${project.name}»${emailed ? " (por email)" : mailFailed ? " (falló el email; queda el enlace para pasarlo a mano)" : " (con enlace, sin email)"}`);
    revalidatePath("/", "layout");
    return { name: created.name, link, emailed, mailFailed };
  });
}

/** ¿Invitación pendiente? Debe elegir contraseña y nunca ha entrado (invitePendingFrom, user-entered.ts). */
async function invitePending(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true, googleSub: true, _count: { select: { sessions: true, knownDevices: true } } },
  });
  return !!user && invitePendingFrom(user);
}

/** «Reenviar invitación»: enlace nuevo (72 h) por email; el anterior deja de valer. Solo para quien aún no ha entrado. */
export async function resendInvite(userId: string) {
  return runAction({ name: "users.resendInvite", args: [userId] }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`resend-invite:${admin.id}`, 20, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    if (!emailEnabled()) throw new AppError("El envío de emails no está configurado.");
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true, active: true } });
    if (!user) throw notFound();
    if (!user.active) throw new AppError("La cuenta está desactivada: actívala antes de reenviar la invitación.");
    if (!(await invitePending(user.id))) throw new AppError("Esta persona ya ha entrado alguna vez: usa «Forzar cambio de contraseña».");
    // Una invitación a un proyecto sigue llevando a su tablero (si la persona aún está en él).
    const pending = await db.authToken.findFirst({ where: { userId: user.id, purpose: "INVITE" }, orderBy: { createdAt: "desc" }, select: { data: true } });
    const projectId = inviteProjectId(pending?.data);
    const keep = projectId && (await db.projectMember.count({ where: { projectId, userId: user.id } })) ? { projectId } : undefined;
    try {
      // issueAuthToken borra antes la invitación pendiente: solo vale el enlace nuevo.
      const token = await issueAuthToken(user.id, "INVITE", keep);
      await sendInviteMail(user, `${appUrl()}/reset/${token}`, admin.name);
    } catch (err) {
      logMailError("[users] reenviar invitación", err);
      throw new AppError("No se pudo enviar la invitación. Revisa el envío de emails en Administración → Integraciones.");
    }
    describeAction(`Reenvió la invitación a «${user.name}»`);
  });
}

const userFields = {
  name: v.name,
  email: v.email,
  role: z.enum(["ADMIN", "MEMBER"]),
  active: z.boolean(),
};

const updateSchema = z.object({
  ...userFields,
  /**
   * Los valores que vio quien edita (los de la lista al abrir «Editar»). Solo se aplican los campos que ha cambiado; si
   * alguno de esos ha cambiado mientras tanto (otro administrador ha desactivado a la persona, le ha cambiado el email…),
   * se rechaza. Sin ellos (un navegador con la versión anterior) no se sabe qué ha cambiado: también se rechaza.
   */
  expected: z.object({ name: z.string().max(200), email: z.string().max(200), role: userFields.role, active: z.boolean() }).optional(),
});

const STALE_USER = "Los datos han cambiado mientras tanto: recarga la página.";

export async function updateUser(userId: string, input: z.input<typeof updateSchema>) {
  return runAction({ name: "users.updateUser", args: [userId, input] }, async () => {
    const admin = await requireAdmin();
    const { expected, ...wanted } = updateSchema.parse(input);
    const id = v.id.parse(userId);
    if (!expected) throw new AppError(STALE_USER, 409);
    if (id === admin.id && (wanted.role !== "ADMIN" || !wanted.active)) {
      throw new AppError("No puedes quitarte el rol de administrador ni desactivarte a ti mismo.");
    }
    const keys = ["name", "email", "role", "active"] as const;
    const changed = new Set(keys.filter((k) => wanted[k] !== expected[k]));
    const unassigned = { count: 0, projectIds: [] as string[] };
    const { user, data } = await db.$transaction(async (tx) => {
      // Candados en orden fijo: plazas de usuarios (reactivar), administradores (quitar uno) y la fila de la persona.
      // Así dos administradores que la editan a la vez van en fila y el segundo compara con lo que dejó el primero;
      // «Borrar mi cuenta» (eraseUser) toma también pz:admins antes de borrar la fila.
      if (changed.has("active") && wanted.active) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pz:max-users'))::text`;
      if ((changed.has("role") && wanted.role !== "ADMIN") || (changed.has("active") && !wanted.active)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMINS_LOCK_NAME}))::text`;
      }
      // NO KEY UPDATE: no bloquea crear sesiones ni dispositivos de la persona (sus claves foráneas solo piden KEY SHARE).
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR NO KEY UPDATE`;
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, locale: true, role: true, active: true } });
      if (!user) throw notFound();
      // Un campo cambiado aquí que otro ha cambiado entretanto (salvo al mismo valor): se rechaza, no se pisa.
      if ([...changed].some((k) => user[k] !== expected[k] && user[k] !== wanted[k])) throw new AppError(STALE_USER, 409);
      // Los que no se han tocado se quedan como están ahora (no como estaban al abrir el formulario).
      const data = { name: changed.has("name") ? wanted.name : user.name, email: changed.has("email") ? wanted.email : user.email, role: changed.has("role") ? wanted.role : user.role, active: changed.has("active") ? wanted.active : user.active };
      // Reactivar ocupa una plaza (ver assertUserSlot; el candado ya está tomado).
      if (data.active && !user.active) await assertUserSlot(tx);
      if (data.email !== user.email && (await tx.user.count({ where: { email: data.email, id: { not: user.id } } }))) {
        throw new AppError("Ya existe un usuario con ese email.");
      }
      // Quitar un administrador activo, con el mismo candado que «Borrar mi cuenta» (eraseUser): si quien lo hace acaba de
      // borrarse a la vez, no se queda la instalación sin ninguno. Como allí, solo cuenta quien ya ha entrado alguna vez.
      if (user.role === "ADMIN" && user.active && (data.role !== "ADMIN" || !data.active)) {
        if ((await tx.user.count({ where: { id: { not: user.id }, role: "ADMIN", active: true, ...HAS_ENTERED } })) === 0) throw new AppError("Debe quedar al menos un administrador activo.");
      }
      const emailChanged = data.email !== user.email;
      // Con otro email, la cuenta de Google vinculada deja de valer (era la de la dirección anterior).
      await tx.user.update({ where: { id: user.id }, data: emailChanged ? { ...data, googleSub: null } : data });
      // Y los enlaces pendientes enviados a la dirección anterior (invitación, restablecer, confirmar) ya no sirven.
      // Al desactivar, ningún enlace pendiente debe «revivir» si se reactiva antes de que caduque.
      if (emailChanged || !data.active) await tx.authToken.deleteMany({ where: { userId: user.id, purpose: { in: ["INVITE", "PASSWORD_RESET", "PASSWORD_CHANGE", "EMAIL_CHANGE"] } } });
      // Los informes semanales que iban a su dirección anterior pasan a la nueva.
      if (emailChanged) await retargetReportSchedules(tx, user.email, data.email);
      // Al cambiar de rol, la asignación a proyectos de equipo se traduce, así no se pierde ni se gana acceso por el
      // cambio: un admin nuevo sigue asignado (ProjectMember) y además los tiene elegidos (AdminProjectPick); quien deja de
      // serlo pasa a estar asignado a los que tenía elegidos. Se lee aquí, con la fila bloqueada: lo que haya cambiado
      // otro administrador mientras tanto también cuenta.
      if (data.role !== user.role && data.role === "ADMIN") {
        const rows = await tx.projectMember.findMany({ where: { userId: user.id, project: { isPrivate: false } }, select: { projectId: true } });
        await tx.adminProjectPick.createMany({ data: rows.map((r) => ({ projectId: r.projectId, userId: user.id })), skipDuplicates: true });
      } else if (data.role !== user.role) {
        const rows = await tx.adminProjectPick.findMany({ where: { userId: user.id }, select: { projectId: true } });
        await tx.projectMember.createMany({ data: rows.map((r) => ({ projectId: r.projectId, userId: user.id })), skipDuplicates: true });
        await tx.adminProjectPick.deleteMany({ where: { userId: user.id } });
        // Como al quitar a alguien de un proyecto (removeProjectMember): las tarjetas que tenga asignadas en proyectos
        // que deja de ver (de equipo que no había elegido; y, por si acaso, privados de los que no es miembro) quedan sin asignar.
        const where = { assigneeId: user.id, project: { members: { none: { userId: user.id } } } };
        const affected = await tx.task.findMany({ where, distinct: ["projectId"], select: { projectId: true } });
        if (affected.length) {
          unassigned.count = (await tx.task.updateMany({ where, data: { assigneeId: null } })).count;
          unassigned.projectIds = affected.map((a) => a.projectId);
        }
      }
      // Al desactivar o cambiar de rol se cierran sus sesiones.
      // Y los accesos a medio completar: al reactivar no deben «revivir», y con otro rol cambia si se exige el segundo paso.
      if (data.active !== user.active || data.role !== user.role) {
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.loginChallenge.deleteMany({ where: { userId: user.id, kind: { in: ["LOGIN", "SETUP"] } } });
      }
      return { user, data };
    });
    // Aviso a la dirección antigua: si alguien se hiciera con la cuenta, el dueño se entera.
    if (data.email !== user.email && emailEnabled()) {
      sendMailInBackground("aviso de email cambiado por un administrador", () => sendEmailChangedMail(user, user.email, data.email));
    }
    // Cualquier canal en vivo (SSE, presencia) del usuario se corta si se ha desactivado o ha cambiado de rol.
    if (data.active !== user.active || data.role !== user.role) revokeUser(user.id);
    // Los tableros abiertos de los proyectos con tarjetas desasignadas se refrescan.
    for (const projectId of unassigned.projectIds) publishChange({ projectId, userId: admin.id, action: "users.updateUser" });
    if (unassigned.count) describeAction("Quitó el rol de administrador a «{name}»; sin asignar en proyectos que ya no ve: {count}", { name: data.name, count: tasksN(unassigned.count) }, { unassigned: unassigned.count });
    revalidatePath("/admin/users");
  });
}

/**
 * «Forzar cambio de contraseña»: el admin no escribe ninguna clave. La contraseña actual deja de valer (se sustituye
 * por el hash de un valor aleatorio que no se guarda ni se muestra: quien la conociera ya no puede entrar con ella),
 * la persona queda obligada a elegir una nueva, se cierran sus sesiones, se anulan sus enlaces pendientes y recibe un
 * enlace de restablecimiento (30 min) por email o el admin lo copia. Con Google (si lo tiene enlazado) sigue
 * pudiendo entrar, pero aterriza en «Elige una contraseña nueva» hasta elegirla.
 * Como la cuenta puede estar en manos de otro, también se corta lo que sigue funcionando sin sesión: el calendario
 * suscrito (su enlace deja de valer), Telegram y WhatsApp (los avisos dejan de llegar a ese chat o teléfono) y Google
 * Drive (como «Desconectar» en Mi perfil). Cambiar o restablecer uno mismo la contraseña no toca nada de esto.
 */
export async function forcePasswordChange(userId: string, opts?: { copyLink?: boolean }) {
  return runAction({ name: "users.forcePasswordChange", args: [userId, !!opts?.copyLink] }, async () => {
    const admin = await requireAdmin();
    if (!rateLimit(`force-password:${admin.id}`, 20, 15 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("Para cambiar tu propia contraseña usa «Mi perfil».");
    // Sin email (o si el admin lo pide) el enlace no se envía: se le devuelve para que lo pase por otro canal.
    const showLink = !emailEnabled() || !!opts?.copyLink;
    // Fuera de la transacción: bcrypt tarda (~0,1 s). El valor aleatorio se descarta enseguida.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { mustChangePassword: true, passwordHash } }),
      db.session.deleteMany({ where: { userId: user.id } }),
      // Los enlaces pendientes (un cambio de email pedido por quien conocía la contraseña, restablecimientos anteriores)
      // dejan de valer: el único válido será el que se genera ahora.
      db.authToken.deleteMany({ where: { userId: user.id, purpose: { in: ["PASSWORD_RESET", "PASSWORD_CHANGE", "EMAIL_CHANGE"] } } }),
      // También los accesos a medio completar (contraseña ya comprobada, falta el segundo paso o configurarlo).
      db.loginChallenge.deleteMany({ where: { userId: user.id, kind: { in: ["LOGIN", "SETUP"] } } }),
      // Lo que sigue funcionando sin sesión: el calendario suscrito, Telegram (con su enlace de conexión a medio usar) y WhatsApp.
      db.calendarFeed.deleteMany({ where: { userId: user.id } }),
      db.userChannel.deleteMany({ where: { userId: user.id } }),
      db.telegramLinkCode.deleteMany({ where: { userId: user.id } }),
    ]);
    // revokeUser también vacía la caché de los calendarios suscritos: el enlace deja de dar sus tareas al momento.
    revokeUser(user.id);
    // Google Drive, como «Desconectar» en Mi perfil (retira el permiso en Google y borra la conexión).
    await disconnectGoogleAccount(user.id);
    // El token nunca se registra: describeAction solo dice qué se hizo.
    if (showLink) {
      const token = await issueAuthToken(user.id, "PASSWORD_RESET");
      describeAction(`Generó un enlace de restablecimiento de contraseña para «${user.name}»`);
      return { emailed: false, link: `${appUrl()}/reset/${token}` as string | null };
    }
    try {
      const token = await issueAuthToken(user.id, "PASSWORD_RESET");
      await sendPasswordResetMail(user, `${appUrl()}/reset/${token}`);
    } catch (err) {
      logMailError("[users] enlace de restablecimiento", err);
      throw new AppError("Se ha forzado el cambio, pero no se pudo enviar el email con el enlace.");
    }
    return { emailed: true, link: null as string | null };
  });
}

/**
 * Restablece la verificación en dos pasos de otra persona (perdió el móvil y los códigos): borra método, secreto,
 * códigos de recuperación y dispositivos recordados. Un administrador tendrá que configurarla de nuevo para entrar con contraseña.
 */
export async function resetUserTwoFactor(userId: string) {
  return runAction({ name: "users.resetUserTwoFactor", args: [userId] }, async () => {
    const admin = await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true, twoFactorMethod: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("Para cambiar tu propia verificación usa «Mi perfil».");
    if (!user.twoFactorMethod) throw new AppError("Esa persona no tiene activada la verificación en dos pasos.");
    await clearTwoFactor(user.id);
    describeAction(`Restableció la verificación en dos pasos de «${user.name}»`);
    if (emailEnabled()) sendMailInBackground("aviso de verificación en dos pasos restablecida", () => sendTwoFactorChangedMail(user, "reset"));
    revalidatePath("/admin/users");
  });
}

/**
 * Desvincula la cuenta de Google del acceso (googleSub = null) y cierra sus sesiones. No toca la conexión con
 * Drive (Docs/Sheets), que es independiente. Queda marcada (googleRelinkBlocked): entrar con Google por email NO la
 * vuelve a enlazar hasta que la persona entre con su contraseña o un admin pulse «Permitir Google» (allowGoogleRelink).
 */
export async function unlinkGoogle(userId: string) {
  return runAction({ name: "users.unlinkGoogle", args: [userId] }, async () => {
    const admin = await requireAdmin();
    if (admin.id === userId) throw new AppError("No puedes desvincular tu propia cuenta de Google desde aquí.");
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true, googleSub: true } });
    if (!user) throw notFound();
    if (!user.googleSub) throw new AppError("Esa persona no tiene una cuenta de Google vinculada.");
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { googleSub: null, googleRelinkBlocked: true } }),
      db.session.deleteMany({ where: { userId: user.id } }),
      // Un acceso con Google a medio completar (falta el segundo paso) tampoco debe poder terminarse.
      db.loginChallenge.deleteMany({ where: { userId: user.id, kind: { in: ["LOGIN", "SETUP"] } } }),
      // Lo que sigue funcionando sin sesión: el calendario suscrito, Telegram (con su enlace de conexión a medio usar) y WhatsApp.
      db.calendarFeed.deleteMany({ where: { userId: user.id } }),
      db.userChannel.deleteMany({ where: { userId: user.id } }),
      db.telegramLinkCode.deleteMany({ where: { userId: user.id } }),
    ]);
    // revokeUser también vacía la caché de los calendarios suscritos: el enlace deja de dar sus tareas al momento.
    revokeUser(user.id);
    // Google Drive, como «Desconectar» en Mi perfil (retira el permiso en Google y borra la conexión).
    await disconnectGoogleAccount(user.id);
    describeAction(`Desvinculó la cuenta de Google de «${user.name}» (no se vuelve a enlazar sola)`);
    if (emailEnabled()) sendMailInBackground("aviso de Google desvinculado", () => sendGoogleUnlinkedMail(user));
    revalidatePath("/admin/users");
  });
}

/** Quita el bloqueo de re-enlazado de Google: el próximo acceso con Google por email vuelve a vincular la cuenta. */
export async function allowGoogleRelink(userId: string) {
  return runAction({ name: "users.allowGoogleRelink", args: [userId] }, async () => {
    await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, googleRelinkBlocked: true } });
    if (!user) throw notFound();
    if (!user.googleRelinkBlocked) throw new AppError("Esa persona no tiene Google bloqueado.");
    await db.user.update({ where: { id: user.id }, data: { googleRelinkBlocked: false } });
    describeAction(`Permitió de nuevo el acceso con Google a «${user.name}»`);
    revalidatePath("/admin/users");
  });
}

/**
 * Borra un usuario. Sus proyectos privados de los que es el único miembro pasan a ser proyectos de equipo, sin miembros
 * (los ven los administradores), salvo los que se pidan borrar en `deleteProjects` (con tareas, releases y adjuntos). En
 * los privados con más miembros simplemente deja de serlo. En los proyectos compartidos sus tareas y comentarios se
 * conservan sin autor. El borrado es el mismo que «Borrar mi cuenta» (eraseUser, user-delete.ts).
 */
export async function deleteUser(userId: string, deleteProjects: string[] = []) {
  return runAction({ name: "users.deleteUser", args: [userId, deleteProjects] }, async () => {
    const admin = await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("No puedes borrarte a ti mismo.");
    const ids = z.array(v.id).max(1000).parse(deleteProjects);
    const { toTeam, deleted } = await eraseUser(user.id, { self: false, deleteProjects: ids, actor: { id: admin.id, name: admin.name } });
    // Los nombres de los proyectos privados no van al registro: los administradores no los veían.
    let message = `Borró el usuario «${user.name}»`;
    if (deleted.length) message += ` y ${deleted.length === 1 ? "su proyecto privado" : `sus ${deleted.length} proyectos privados`}`;
    if (toTeam.length) message += `; ${toTeam.length === 1 ? "su proyecto privado pasa" : `sus ${toTeam.length} proyectos privados pasan`} a ser de equipo`;
    describeAction(message);
    revalidatePath("/", "layout");
  });
}
