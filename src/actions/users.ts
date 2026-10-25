"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { AppError, notFound } from "@/lib/errors";
import { MAX_USERS } from "@/lib/limits";
import { randomBytes } from "node:crypto";
import { sendEmailChangedMail, sendGoogleUnlinkedMail, sendInviteMail, sendPasswordResetMail, sendTwoFactorChangedMail } from "@/lib/auth-mail";
import { issueAuthToken } from "@/lib/auth-token";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { hashPassword, passwordSchema } from "@/lib/password";
import { purgeProject } from "@/lib/project-delete";
import { discardUndo } from "@/lib/undo";
import { requireAdmin } from "@/lib/session";
import { clearTwoFactor } from "@/lib/two-factor";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";
import { revokeUser } from "@/lib/revoke";

const createSchema = z.object({
  name: v.name,
  email: v.email,
  /** Solo se pide sin email configurado; con email, la persona elige la suya desde la invitación. */
  password: z.string().max(200).optional(),
  role: z.enum(["ADMIN", "MEMBER"]),
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
  return runAction({ name: "users.createUser", args: [{ name: input.name, email: input.email, role: input.role }] }, async () => {
    const admin = await requireAdmin();
    const data = createSchema.parse(input);
    const invite = emailEnabled();
    const initial = invite ? null : passwordSchema("La contraseña debe tener al menos 10 caracteres.").parse(data.password ?? "");
    await assertUserSlot(db);
    if (await db.user.count({ where: { email: data.email } })) throw new AppError("Ya existe un usuario con ese email.");
    // Con invitación la contraseña provisional es aleatoria y nadie la conoce.
    const passwordHash = await hashPassword(initial ?? randomBytes(32).toString("base64url"));
    // El recuento se repite dentro de la transacción, con el candado: dos altas a la vez no pasan del tope.
    const created = await db.$transaction(async (tx) => {
      await assertUserSlot(tx);
      return tx.user.create({
        data: { name: data.name, email: data.email, role: data.role, mustChangePassword: true, passwordHash },
        select: { id: true, name: true, email: true, locale: true },
      });
    });
    revalidatePath("/admin/users");
    if (!invite) return { invited: false };
    try {
      const token = await issueAuthToken(created.id, "INVITE");
      await sendInviteMail(created, `${appUrl()}/reset/${token}`, admin.name);
    } catch (err) {
      console.error("[users] invitación", err);
      throw new AppError("Usuario creado, pero no se pudo enviar la invitación. Usa «Forzar cambio de contraseña» para reenviarla.");
    }
    return { invited: true };
  });
}

const updateSchema = z.object({
  name: v.name,
  email: v.email,
  role: z.enum(["ADMIN", "MEMBER"]),
  active: z.boolean(),
});

export async function updateUser(userId: string, input: z.input<typeof updateSchema>) {
  return runAction({ name: "users.updateUser", args: [userId, input] }, async () => {
    const admin = await requireAdmin();
    const data = updateSchema.parse(input);
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true, role: true, active: true } });
    if (!user) throw notFound();
    if (user.id === admin.id && (data.role !== "ADMIN" || !data.active)) {
      throw new AppError("No puedes quitarte el rol de administrador ni desactivarte a ti mismo.");
    }
    const reactivating = data.active && !user.active;
    if (reactivating) await assertUserSlot(db);
    if (await db.user.count({ where: { email: data.email, id: { not: user.id } } })) {
      throw new AppError("Ya existe un usuario con ese email.");
    }
    // Al cambiar de rol, la asignación a proyectos de equipo se traduce: un admin la lleva en AdminProjectPick
    // y el resto en ProjectMember, así no se pierde ni se gana acceso por el cambio.
    const roleSwitch: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [];
    if (data.role !== user.role) {
      const teamOnly = { project: { isPrivate: false } };
      if (data.role === "ADMIN") {
        const rows = await db.projectMember.findMany({ where: { userId: user.id, ...teamOnly }, select: { projectId: true } });
        roleSwitch.push(
          (tx) => tx.adminProjectPick.createMany({ data: rows.map((r) => ({ projectId: r.projectId, userId: user.id })), skipDuplicates: true }),
          (tx) => tx.projectMember.deleteMany({ where: { userId: user.id, ...teamOnly } }),
        );
      } else {
        const rows = await db.adminProjectPick.findMany({ where: { userId: user.id }, select: { projectId: true } });
        roleSwitch.push(
          (tx) => tx.projectMember.createMany({ data: rows.map((r) => ({ projectId: r.projectId, userId: user.id })), skipDuplicates: true }),
          (tx) => tx.adminProjectPick.deleteMany({ where: { userId: user.id } }),
        );
      }
    }
    const emailChanged = data.email !== user.email;
    await db.$transaction(async (tx) => {
      // Reactivar ocupa una plaza: se vuelve a contar con el candado de altas (ver assertUserSlot).
      if (reactivating) await assertUserSlot(tx);
      // Con otro email, la cuenta de Google vinculada deja de valer (era la de la dirección anterior).
      await tx.user.update({ where: { id: user.id }, data: emailChanged ? { ...data, googleSub: null } : data });
      // Y los enlaces pendientes enviados a la dirección anterior (invitación, restablecer, confirmar) ya no sirven.
      if (emailChanged) await tx.authToken.deleteMany({ where: { userId: user.id, purpose: { in: ["INVITE", "PASSWORD_RESET", "PASSWORD_CHANGE", "EMAIL_CHANGE"] } } });
      for (const op of roleSwitch) await op(tx);
      // Al desactivar o cambiar de rol se cierran sus sesiones.
      if (data.active !== user.active || data.role !== user.role) await tx.session.deleteMany({ where: { userId: user.id } });
    });
    // Aviso a la dirección antigua: si alguien se hiciera con la cuenta, el dueño se entera.
    if (data.email !== user.email && emailEnabled()) {
      sendMailInBackground("aviso de email cambiado por un administrador", () => sendEmailChangedMail(user, user.email, data.email));
    }
    // Cualquier canal en vivo (SSE, presencia) del usuario se corta si se ha desactivado o ha cambiado de rol.
    if (data.active !== user.active || data.role !== user.role) revokeUser(user.id);
    revalidatePath("/admin/users");
  });
}

/**
 * «Forzar cambio de contraseña»: el admin no escribe ninguna clave. La persona queda obligada a elegir una
 * nueva, se cierran sus sesiones y, con email configurado, recibe un enlace de restablecimiento (30 min).
 */
export async function forcePasswordChange(userId: string) {
  return runAction({ name: "users.forcePasswordChange", args: [userId] }, async () => {
    const admin = await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("Para cambiar tu propia contraseña usa «Mi perfil».");
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    revokeUser(user.id);
    if (!emailEnabled()) return { emailed: false };
    try {
      const token = await issueAuthToken(user.id, "PASSWORD_RESET");
      await sendPasswordResetMail(user, `${appUrl()}/reset/${token}`);
    } catch (err) {
      console.error("[users] enlace de restablecimiento", err);
      throw new AppError("Se ha forzado el cambio, pero no se pudo enviar el email con el enlace.");
    }
    return { emailed: true };
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
 * Drive (Docs/Sheets), que es independiente. Si la persona vuelve a entrar con Google con el mismo email, se enlaza de nuevo.
 */
export async function unlinkGoogle(userId: string) {
  return runAction({ name: "users.unlinkGoogle", args: [userId] }, async () => {
    await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true, email: true, locale: true, googleSub: true } });
    if (!user) throw notFound();
    if (!user.googleSub) throw new AppError("Esa persona no tiene una cuenta de Google vinculada.");
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { googleSub: null } }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    revokeUser(user.id);
    describeAction(`Desvinculó la cuenta de Google de «${user.name}»`);
    if (emailEnabled()) sendMailInBackground("aviso de Google desvinculado", () => sendGoogleUnlinkedMail(user));
    revalidatePath("/admin/users");
  });
}

/**
 * Borra un usuario. De sus proyectos privados solo se borran (con tareas, releases y adjuntos) aquellos
 * en los que es el único miembro: si tiene alguno hay que confirmarlo expresamente. En los privados
 * con más miembros simplemente deja de serlo. En los proyectos compartidos sus tareas y
 * comentarios se conservan sin autor.
 */
export async function deleteUser(userId: string, confirmPrivate: boolean) {
  return runAction({ name: "users.deleteUser", args: [userId, confirmPrivate] }, async () => {
    const admin = await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("No puedes borrarte a ti mismo.");
    const privates = await db.project.findMany({
      where: { isPrivate: true, members: { some: { userId: user.id }, none: { userId: { not: user.id } } } },
      select: { id: true },
    });
    if (privates.length > 0 && confirmPrivate !== true) {
      const t = await getT();
      const count = privates.length === 1 ? t("1 proyecto privado") : t("{n} proyectos privados", { n: privates.length });
      throw new AppError(t("{name} es el único miembro de {count}: confirma que se borren.", { name: user.name, count }));
    }
    for (const p of privates) await purgeProject(p.id);
    await discardUndo({ userId: user.id });
    await db.user.delete({ where: { id: user.id } });
    revokeUser(user.id);
    describeAction(
      privates.length
        ? `Borró el usuario «${user.name}» y ${privates.length === 1 ? "su proyecto privado" : `sus ${privates.length} proyectos privados`}`
        : `Borró el usuario «${user.name}»`,
    );
    revalidatePath("/", "layout");
  });
}
