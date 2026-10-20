"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { requestContext } from "@/lib/request-context";
import { dummyVerify, verifyPassword } from "@/lib/password";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { safeNextPath } from "@/lib/redirect";
import { createSession, destroySession, getCurrentUser } from "@/lib/session";
import { getT } from "@/i18n/server";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: t("Introduce email y contraseña.") };
  const { email, password } = parsed.data;

  const ip = clientIp(await headers());
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;
  if (!rateLimit(ipKey, 20, 15 * 60_000) || !rateLimit(emailKey, 8, 15 * 60_000)) {
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", message: `Inicio de sesión bloqueado por demasiados intentos (${email})`,
      path: "/login", ip, details: { email, reason: "rate_limited" },
    });
    return { error: t("Demasiados intentos. Espera unos minutos.") };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, passwordHash: true, active: true } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password);
  if (!user || !valid || !user.active) {
    const reason = !user ? "unknown_email" : !valid ? "wrong_password" : "inactive";
    const why = reason === "inactive" ? "usuario desactivado" : reason === "unknown_email" ? "email desconocido" : "contraseña incorrecta";
    logEvent({
      level: "warn", category: "auth", action: "auth.loginFailed", message: `Inicio de sesión fallido (${email}): ${why}`,
      userId: user?.id ?? null, userName: user?.name ?? null, path: "/login", ip, details: { email, reason },
    });
    return { error: t("Credenciales incorrectas.") };
  }

  resetRateLimit(emailKey);
  await createSession(user.id);
  logEvent({
    category: "auth", action: "auth.login", message: `${user.name} ha iniciado sesión`,
    userId: user.id, userName: user.name, path: "/login", ip, details: { email },
  });
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function logout(): Promise<void> {
  const [user, ctx] = await Promise.all([getCurrentUser().catch(() => null), requestContext()]);
  if (user) logEvent({ category: "auth", action: "auth.logout", message: `${user.name} ha cerrado sesión`, userId: user.id, userName: user.name, path: ctx.path, ip: ctx.ip });
  await destroySession();
  redirect("/login");
}
