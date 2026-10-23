// Utilidades de los tests de integración (se ejecutan con `npm run test:db`, contra una base efímera).
// Las acciones se llaman como en producción: la sesión es una fila real en la BD y su token viaja en la
// cookie del «jar» que sustituye a next/headers (ver register.mjs). Los datos se crean con Prisma directamente.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.COOKIE_SECURE ??= "false";

// Salvaguarda: estos tests escriben y borran datos; solo corren contra una base creada por scripts/test-db.mjs.
const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://none/none").pathname.slice(1);
if (!/^pizarro_test_[0-9a-f]+$/.test(dbName)) {
  throw new Error("Los tests de BD solo se ejecutan con `npm run test:db` (base pizarro_test_*). Abortando para no tocar datos reales.");
}

const { db } = await import("../../src/lib/db");
const { createSession } = await import("../../src/lib/session");

export { db };

const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;

after(async () => {
  await db.$disconnect();
});

const uid = () => randomBytes(5).toString("hex");

type Role = "ADMIN" | "MEMBER";

export async function makeUser(opts: { role?: Role; name?: string; active?: boolean; mustChangePassword?: boolean } = {}) {
  const tag = uid();
  return db.user.create({
    data: {
      email: `u-${tag}@example.test`,
      name: opts.name ?? `Usuario ${tag}`,
      // Hash inválido a propósito: los tests no inician sesión con contraseña.
      passwordHash: "!",
      role: opts.role ?? "MEMBER",
      active: opts.active ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
}

type UserRow = Awaited<ReturnType<typeof makeUser>>;

/** Las acciones siguientes se ejecutan como este usuario (sesión real creada con createSession). */
export async function loginAs(user: UserRow | { id: string }): Promise<void> {
  jar.clear();
  await createSession(user.id);
}

/** Sin sesión (cookie ausente). */
export function logout(): void {
  jar.clear();
}

/** Guarda la cookie de la sesión actual para reutilizarla después (p. ej. tras cerrarla otra persona). */
export function saveSession(): Map<string, string> {
  return new Map(jar);
}

export function restoreSession(saved: Map<string, string>): void {
  jar.clear();
  for (const [k, v] of saved) jar.set(k, v);
}

export async function asUser<T>(user: UserRow | { id: string }, fn: () => Promise<T>): Promise<T> {
  await loginAs(user);
  return fn();
}

export async function makeKind(projectId: string | null = null) {
  return db.taskKind.create({ data: { name: `Tipo ${uid()}`, color: "#3b82f6", position: 1, projectId } });
}

/** Asigna a un usuario a un proyecto (ProjectMember). */
export async function assign(f: { project: { id: string } }, user: { id: string }) {
  await db.projectMember.upsert({ where: { projectId_userId: { projectId: f.project.id, userId: user.id } }, create: { projectId: f.project.id, userId: user.id }, update: {} });
}

export type Visibility = "TEAM" | "PRIVATE";

export interface Fixture {
  project: { id: string; name: string };
  columns: { todo: string; doing: string; done: string };
  kindId: string;
}

/**
 * Proyecto con tres columnas (la última «terminada») y un tipo propio.
 * PRIVATE: `owner` es el dueño y primer miembro; TEAM: `members` son los usuarios asignados (los admins lo ven siempre).
 */
export async function makeProject(opts: { visibility?: Visibility; members?: { id: string }[]; owner?: { id: string } } = {}): Promise<Fixture> {
  const visibility = opts.visibility ?? "TEAM";
  // En un proyecto de equipo sin `members`, se asigna a todos los usuarios activos no administradores que ya existan
  // (la mayoría de pruebas no tratan de permisos); con `members: []` queda sin asignados.
  const members = [...(opts.members ?? (visibility === "TEAM" ? await db.user.findMany({ where: { active: true, role: { not: "ADMIN" } }, select: { id: true } }) : []))];
  if (visibility === "PRIVATE") {
    assert.ok(opts.owner, "un proyecto privado necesita dueño");
    if (!members.some((m) => m.id === opts.owner!.id)) members.push(opts.owner);
  }
  const project = await db.project.create({
    data: {
      name: `Proyecto ${uid()}`,
      isPrivate: visibility === "PRIVATE",
      privateOwnerId: visibility === "PRIVATE" ? opts.owner!.id : null,
      members: { create: members.map((m) => ({ userId: m.id })) },
      columns: {
        create: [
          { name: "Por hacer", position: 1000 },
          { name: "En curso", position: 2000 },
          { name: "Hecho", position: 3000, isDone: true },
        ],
      },
    },
    select: { id: true, name: true, columns: { orderBy: { position: "asc" }, select: { id: true } } },
  });
  const kind = await makeKind(project.id);
  const [todo, doing, done] = project.columns;
  return { project: { id: project.id, name: project.name }, columns: { todo: todo!.id, doing: doing!.id, done: done!.id }, kindId: kind.id };
}

/** Tarea creada directamente en la BD (sin pasar por las acciones, para no generar entradas de deshacer). */
export async function makeTask(f: Fixture, opts: { title?: string; columnId?: string; position?: number; createdById?: string | null; subtasks?: string[]; recurrence?: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY"; dueDate?: Date } = {}) {
  return db.task.create({
    data: {
      projectId: f.project.id,
      columnId: opts.columnId ?? f.columns.todo,
      title: opts.title ?? `Tarea ${uid()}`,
      kindId: f.kindId,
      position: opts.position ?? 1000,
      createdById: opts.createdById ?? null,
      recurrence: opts.recurrence ?? "NONE",
      dueDate: opts.dueDate ?? null,
      subtasks: { create: (opts.subtasks ?? []).map((title, i) => ({ title, position: (i + 1) * 1000 })) },
    },
  });
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** La acción debe terminar bien; devuelve sus datos. */
export function expectOk<T>(res: Result<T>): T {
  assert.ok(res.ok, res.ok ? "" : `la acción falló: ${res.error}`);
  return res.data;
}

/** La acción debe rechazarse; si se indica `message`, el error debe contenerlo. */
export function expectFail(res: Result<unknown>, message?: RegExp | string): string {
  assert.equal(res.ok, false, "la acción debería haberse rechazado");
  const error = (res as { ok: false; error: string }).error;
  if (message) assert.match(error, message instanceof RegExp ? message : new RegExp(message));
  return error;
}

export const NOT_FOUND = /No encontrado o sin acceso/;
export const FORBIDDEN = /No tienes permiso/;
export const SESSION_EXPIRED = /Sesión caducada/;
