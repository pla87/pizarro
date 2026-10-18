"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { dummyVerify, verifyPassword } from "@/lib/password";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { safeNextPath } from "@/lib/redirect";
import { createSession, destroySession } from "@/lib/session";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Introduce email y contraseña." };
  const { email, password } = parsed.data;

  const ip = clientIp(await headers());
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;
  if (!rateLimit(ipKey, 20, 15 * 60_000) || !rateLimit(emailKey, 8, 15 * 60_000)) {
    return { error: "Demasiados intentos. Espera unos minutos." };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, active: true } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : await dummyVerify(password);
  if (!user || !valid || !user.active) return { error: "Credenciales incorrectas." };

  resetRateLimit(emailKey);
  await createSession(user.id);
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
