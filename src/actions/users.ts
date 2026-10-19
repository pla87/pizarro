"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { logEvent } from "@/lib/log";
import { AppError, notFound } from "@/lib/errors";
import { MAX_USERS } from "@/lib/limits";
import { hashPassword, MIN_PASSWORD } from "@/lib/password";
import { requireAdmin } from "@/lib/session";
import * as v from "@/lib/validation";

const password = z.string().min(MIN_PASSWORD, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`).max(200);

const createSchema = z.object({
  name: v.name,
  email: v.email,
  password,
  role: z.enum(["ADMIN", "MEMBER"]),
});

export async function createUser(input: z.input<typeof createSchema>) {
  return runAction({ name: "users.createUser", args: [input] }, async () => {
    await requireAdmin();
    const data = createSchema.parse(input);
    const active = await db.user.count({ where: { active: true } });
    if (active >= MAX_USERS) throw new AppError(`Se ha alcanzado el máximo de ${MAX_USERS} usuarios activos.`);
    if (await db.user.count({ where: { email: data.email } })) throw new AppError("Ya existe un usuario con ese email.");
    await db.user.create({
      data: { name: data.name, email: data.email, role: data.role, passwordHash: await hashPassword(data.password) },
    });
    revalidatePath("/admin/users");
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
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true, role: true, active: true } });
    if (!user) throw notFound();
    if (user.id === admin.id && (data.role !== "ADMIN" || !data.active)) {
      throw new AppError("No puedes quitarte el rol de administrador ni desactivarte a ti mismo.");
    }
    if (data.active && !user.active) {
      const active = await db.user.count({ where: { active: true } });
      if (active >= MAX_USERS) throw new AppError(`Se ha alcanzado el máximo de ${MAX_USERS} usuarios activos.`);
    }
    if (await db.user.count({ where: { email: data.email, id: { not: user.id } } })) {
      throw new AppError("Ya existe un usuario con ese email.");
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data }),
      // Al desactivar o cambiar de rol se cierran sus sesiones.
      ...(data.active !== user.active || data.role !== user.role ? [db.session.deleteMany({ where: { userId: user.id } })] : []),
    ]);
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

export async function resetUserPassword(userId: string, newPassword: string) {
  return runAction({ name: "users.resetUserPassword", args: [userId, newPassword] }, async () => {
    await requireAdmin();
    const pw = password.parse(newPassword);
    const user = await db.user.findUnique({ where: { id: v.id.parse(userId) }, select: { id: true } });
    if (!user) throw notFound();
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
  });
}
