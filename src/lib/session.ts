import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { AppError, forbidden } from "./errors";
import { logEvent } from "./log";
import { revokeSession } from "./revoke";
import { requestContext } from "./request-context";
import { clientIp } from "./request";
import { PASSWORD_CHANGE_COOKIE, SESSION_MAX_AGE_SECONDS, sessionCookieName, sessionCookieOptions } from "./session-config";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  theme: "SYSTEM" | "LIGHT" | "DARK";
  accent: "BLUE" | "FOREST" | "SIENNA" | "MUSTARD" | "MONO" | "EVA";
  locale: "ES" | "EN";
  /** Preferencia: borrar los borradores locales al cerrar sesión (lo hace el cliente antes de enviar el cierre). */
  clearDraftsOnLogout: boolean;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return s;
}

function sessionIdFromToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

/** Como mucho cada 5 minutos se anota la última actividad de la sesión (una escritura barata). */
const LAST_SEEN_EVERY_MS = 5 * 60_000;
const UA_MAX = 255;

/** Hash de la sesión de esta petición (para marcarla como «esta sesión»), sin consultar la BD. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return token && token.length <= 100 ? sessionIdFromToken(token) : null;
}

/**
 * Abre sesión. `mustChangePassword` deja la marca para que proxy.ts limite la navegación hasta que
 * la persona elija una contraseña nueva.
 */
export async function createSession(userId: string, opts: { mustChangePassword?: boolean } = {}): Promise<void> {
  const store = await cookies();
  // Si el navegador ya traía una sesión (otra cuenta, o la misma), se cierra: un token viejo no sobrevive al inicio de sesión.
  const previous = store.get(sessionCookieName())?.value;
  if (previous && previous.length <= 100) await db.session.deleteMany({ where: { id: sessionIdFromToken(previous) } });
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await db.session.create({
    data: {
      id: sessionIdFromToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      userAgent: h.get("user-agent")?.slice(0, UA_MAX) ?? null,
      ip: clientIp(h).slice(0, 64),
    },
  });
  // Limpieza oportunista de sesiones caducadas (barato con 5 usuarios).
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  store.set(sessionCookieName(), token, sessionCookieOptions());
  if (opts.mustChangePassword) store.set(PASSWORD_CHANGE_COOKIE, "1", sessionCookieOptions());
  else store.delete(PASSWORD_CHANGE_COOKIE);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token && token.length <= 100) {
    const id = sessionIdFromToken(token);
    await db.session.deleteMany({ where: { id } });
    revokeSession(id);
  }
  store.delete(sessionCookieName());
  store.delete(PASSWORD_CHANGE_COOKIE);
}

interface SessionUser extends CurrentUser {
  mustChangePassword: boolean;
}

/** Usuario de la sesión de la petición (una sola consulta gracias a cache()), pendiente o no de cambiar la contraseña. */
const loadSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;
  const id = sessionIdFromToken(token);
  const session = await db.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, role: true, theme: true, accent: true, locale: true, clearDraftsOnLogout: true, active: true, mustChangePassword: true } },
    },
  });
  if (!session || !session.user.active) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  // Expiración deslizante: se renueva cuando ha consumido la mitad de su vida. Y la última actividad, cada 5 minutos.
  const renew = session.expiresAt.getTime() - now < (SESSION_MAX_AGE_SECONDS * 1000) / 2;
  const touch = now - session.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS;
  if (renew || touch) {
    await db.session.update({
      where: { id },
      data: { ...(renew ? { expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000) } : {}), ...(touch ? { lastSeenAt: new Date(now) } : {}) },
    }).catch(() => {});
  }
  const { active: _active, ...user } = session.user;
  return user;
});

/**
 * Usuario de la petición actual. Con la contraseña pendiente de cambiar devuelve null: así páginas,
 * acciones y rutas API quedan bloqueadas por defecto hasta que la elija (ver getPendingUser).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await loadSessionUser();
  if (!user || user.mustChangePassword) return null;
  const { mustChangePassword: _m, ...rest } = user;
  return rest;
});

/** Usuario con sesión abierta que debe elegir una contraseña nueva antes de seguir; null en cualquier otro caso. */
export const getPendingUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await loadSessionUser();
  if (!user?.mustChangePassword) return null;
  const { mustChangePassword: _m, ...rest } = user;
  return rest;
});

/** Para Server Components: redirige a /login si no hay sesión. */
export async function requireUserPage(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect((await getPendingUser()) ? "/change-password" : "/login");
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
  if (!user) {
    if (await getPendingUser()) throw new AppError("Debes elegir una contraseña nueva antes de continuar.", 403);
    throw new AppError("Sesión caducada. Vuelve a iniciar sesión.", 401);
  }
  return user;
}

/** Para la pantalla y la acción de «elige una contraseña nueva»: solo sirve con el cambio pendiente. */
export async function requirePendingUser(): Promise<CurrentUser> {
  const user = await getPendingUser();
  if (!user) throw new AppError("Sesión caducada. Vuelve a iniciar sesión.", 401);
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw forbidden();
  return user;
}

