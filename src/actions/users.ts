"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { logEvent } from "@/lib/log";
import { AppError, notFound } from "@/lib/errors";
import { MAX_USERS } from "@/lib/limits";
import { randomBytes } from "node:crypto";
import { sendEmailChangedMail, sendInviteMail, sendPasswordResetMail } from "@/lib/auth-mail";
import { issueAuthToken } from "@/lib/auth-token";
import { appUrl, emailEnabled, sendMailInBackground } from "@/lib/mail";
import { hashPassword, passwordSchema } from "@/lib/password";
import { purgeProject } from "@/lib/project-delete";
import { discardUndo } from "@/lib/undo";
import { requireAdmin } from "@/lib/session";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";

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
export async function createUser(input: z.input<typeof createSchema>) {
  return runAction({ name: "users.createUser", args: [{ name: input.name, email: input.email, role: input.role }] }, async () => {
    const admin = await requireAdmin();
    const data = createSchema.parse(input);
    const invite = emailEnabled();
    const initial = invite ? null : passwordSchema("La contraseña debe tener al menos 10 caracteres.").parse(data.password ?? "");
    const active = await db.user.count({ where: { active: true } });
    if (active >= MAX_USERS) {
      const t = await getT();
      throw new AppError(t("Se ha alcanzado el máximo de {n} usuarios activos.", { n: MAX_USERS }));
    }
    if (await db.user.count({ where: { email: data.email } })) throw new AppError("Ya existe un usuario con ese email.");
    // Con invitación la contraseña provisional es aleatoria y nadie la conoce.
    const created = await db.user.create({
      data: { name: data.name, email: data.email, role: data.role, mustChangePassword: true, passwordHash: await hashPassword(initial ?? randomBytes(32).toString("base64url")) },
      select: { id: true, name: true, email: true, locale: true },
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
    if (data.active && !user.active) {
      const active = await db.user.count({ where: { active: true } });
      if (active >= MAX_USERS) {
      const t = await getT();
      throw new AppError(t("Se ha alcanzado el máximo de {n} usuarios activos.", { n: MAX_USERS }));
    }
    }
    if (await db.user.count({ where: { email: data.email, id: { not: user.id } } })) {
      throw new AppError("Ya existe un usuario con ese email.");
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data }),
      // Al desactivar o cambiar de rol se cierran sus sesiones.
      ...(data.active !== user.active || data.role !== user.role ? [db.session.deleteMany({ where: { userId: user.id } })] : []),
    ]);
    // Aviso a la dirección antigua: si alguien se hiciera con la cuenta, el dueño se entera.
    if (data.email !== user.email && emailEnabled()) {
      sendMailInBackground("aviso de email cambiado por un administrador", () => sendEmailChangedMail(user, user.email, data.email));
    }
    // Proyectos privados: se bloquean si el dueño deja de ser admin activo y se desbloquean al volver a serlo.
    const wasAdmin = user.active && user.role === "ADMIN";
    const isAdmin = data.active && data.role === "ADMIN";
    if (wasAdmin && !isAdmin) {
      const { count } = await db.project.updateMany({ where: { privateOwnerId: user.id, privateBlockedAt: null }, data: { privateBlockedAt: new Date() } });
      if (count > 0) logEvent({ category: "system", action: "projects.privateBlocked", message: `Proyectos privados bloqueados: ${count}`, details: { ownerId: user.id, count } });
    } else if (!wasAdmin && isAdmin) {
      const { count } = await db.project.updateMany({ where: { privateOwnerId: user.id, privateBlockedAt: { not: null } }, data: { privateBlockedAt: null } });
      if (count > 0) logEvent({ category: "system", action: "projects.privateUnblocked", message: `Proyectos privados desbloqueados: ${count}`, details: { ownerId: user.id, count } });
    }
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
 * Borra un usuario. Sus proyectos privados se borran con él (con tareas, releases y adjuntos):
 * si tiene alguno hay que confirmarlo expresamente. En los proyectos compartidos sus tareas y
 * comentarios se conservan sin autor.
 */
export async function deleteUser(userId: string, confirmPrivate: boolean) {
  return runAction({ name: "users.deleteUser", args: [userId, confirmPrivate] }, async () => {
    const admin = await requireAdmin();
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, name: true } });
    if (!user) throw notFound();
    if (user.id === admin.id) throw new AppError("No puedes borrarte a ti mismo.");
    const privates = await db.project.findMany({ where: { privateOwnerId: user.id }, select: { id: true } });
    if (privates.length > 0 && confirmPrivate !== true) {
      const t = await getT();
      const count = privates.length === 1 ? t("1 proyecto privado") : t("{n} proyectos privados", { n: privates.length });
      throw new AppError(t("{name} tiene {count}: confirma que se borren.", { name: user.name, count }));
    }
    for (const p of privates) await purgeProject(p.id);
    await discardUndo({ userId: user.id });
    await db.user.delete({ where: { id: user.id } });
    describeAction(
      privates.length
        ? `Borró el usuario «${user.name}» y ${privates.length === 1 ? "su proyecto privado" : `sus ${privates.length} proyectos privados`}`
        : `Borró el usuario «${user.name}»`,
    );
    revalidatePath("/", "layout");
  });
}
