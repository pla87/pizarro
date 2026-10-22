import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { AppError, forbidden } from "./errors";
import { logEvent } from "./log";
import { requestContext } from "./request-context";
import { SESSION_MAX_AGE_SECONDS, sessionCookieName, sessionCookieOptions } from "./session-config";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  theme: "SYSTEM" | "LIGHT" | "DARK";
  accent: "BLUE" | "FOREST" | "SIENNA" | "MUSTARD" | "MONO" | "EVA";
  locale: "ES" | "EN";
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return s;
}

function sessionIdFromToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const store = await cookies();
  // Si el navegador ya traía una sesión (otra cuenta, o la misma), se cierra: un token viejo no sobrevive al inicio de sesión.
  const previous = store.get(sessionCookieName())?.value;
  if (previous && previous.length <= 100) await db.session.deleteMany({ where: { id: sessionIdFromToken(previous) } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      id: sessionIdFromToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  });
  // Limpieza oportunista de sesiones caducadas (barato con 5 usuarios).
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  store.set(sessionCookieName(), token, sessionCookieOptions());
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) await db.session.deleteMany({ where: { id: sessionIdFromToken(token) } });
  store.delete(sessionCookieName());
}

/** Usuario de la petición actual (una sola consulta por petición gracias a cache()). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;
  const id = sessionIdFromToken(token);
  const session = await db.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, theme: true, accent: true, locale: true, active: true } },
    },
  });
  if (!session || !session.user.active) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  // Expiración deslizante: se renueva cuando ha consumido la mitad de su vida.
  if (session.expiresAt.getTime() - now < (SESSION_MAX_AGE_SECONDS * 1000) / 2) {
    await db.session.update({ where: { id }, data: { expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000) } });
  }
  const { active: _active, ...user } = session.user;
  return user;
});

/** Para Server Components: redirige a /login si no hay sesión. */
export async function requireUserPage(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await logPageView(user);
  return user;
}

/** Registra la visita de página una sola vez por petición (layout y página llaman a requireUserPage). */
// Los refrescos automáticos del tablero repiten la misma visita: una por persona y página cada minuto basta.
const PAGE_VIEW_DEDUP_MS = 60_000;
const recentViews = (globalThis as unknown as { __pzViews?: Map<string, number> }).__pzViews ??= new Map();

const logPageView = cache(async (user: CurrentUser): Promise<void> => {
  try {
    const { ip, path } = await requestContext();
    if (!path) return;
    const key = `${user.id} ${path}`;
    const now = Date.now();
    if (now - (recentViews.get(key) ?? 0) < PAGE_VIEW_DEDUP_MS) return;
    recentViews.set(key, now);
    if (recentViews.size > 5000) for (const [k, at] of recentViews) if (now - at > PAGE_VIEW_DEDUP_MS) recentViews.delete(k);
    const projectId = /^\/p\/([a-z0-9]+)/i.exec(path)?.[1] ?? null;
    logEvent({ category: "page", action: "page.view", message: `Visita a ${path}`, userId: user.id, userName: user.name, projectId, path, ip });
  } catch {
    // El registro nunca debe romper la página.
  }
});

export async function requireAdminPage(): Promise<CurrentUser> {
  const user = await requireUserPage();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

/** Para acciones y rutas API: lanza error si no hay sesión. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Sesión caducada. Vuelve a iniciar sesión.", 401);
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw forbidden();
  return user;
}
