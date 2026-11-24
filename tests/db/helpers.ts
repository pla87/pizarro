// Utilidades de los tests de integración (se ejecutan con `npm run test:db`, contra una base efímera).
// Las acciones se llaman como en producción: la sesión es una fila real en la BD y su token viaja en la
// cookie del «jar» que sustituye a next/headers (ver register.mjs). Los datos se crean con Prisma directamente.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
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

const testRequest = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string>; inRequest: <T>(fn: () => Promise<T>) => Promise<T> } }).__pzTestRequest;
const jar = testRequest.jar;

/**
 * Ejecuta `fn` como una sola petición HTTP: dentro, cookies() devuelve siempre el mismo objeto (como en Next), así
 * que lo que se memoriza por petición (la sesión) se reutiliza. Fuera de inRequest cada llamada es una petición aparte.
 */
export function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return testRequest.inRequest(fn);
}

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

/**
 * Deja libres estos nombres de persona: las pruebas que emparejan por nombre (importar de Trello o Jira) necesitan que sea
 * único en la base, y otro fichero que pasó antes en la misma base pudo crear a alguien que se llama igual.
 */
export async function freeUserNames(...names: string[]): Promise<void> {
  await db.user.updateMany({ where: { name: { in: names } }, data: { name: `Otra persona ${uid()}` } });
}

export async function makeKind(projectId: string | null = null) {
  return db.taskKind.create({ data: { name: `Tipo ${uid()}`, color: "#3b82f6", position: 1, projectId } });
}

/** Asigna a un usuario a un proyecto (ProjectMember). */
export async function assign(f: { project: { id: string } }, user: { id: string }) {
  await db.projectMember.upsert({ where: { projectId_userId: { projectId: f.project.id, userId: user.id } }, create: { projectId: f.project.id, userId: user.id }, update: {} });
}

type Visibility = "TEAM" | "PRIVATE";

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

/** Exportar un proyecto como un administrador (con los emails de todas las personas citadas). */
export const ADMIN_EXPORT = { userId: "", isAdmin: true };

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** La acción debe terminar bien; devuelve sus datos. */
export function expectOk<T>(res: Result<T>): T {
  assert.ok(res.ok, res.ok ? "" : `la acción falló: ${res.error}`);
  return res.data;
}

/** Deshacer o rehacer como el botón (undoChecked/redoChecked): debe aplicarse sin pedir confirmación; devuelve lo aplicado. */
export function expectApplied<T>(res: Result<{ applied?: T; conflict?: { message: string } }>): T {
  const data = expectOk(res);
  assert.ok(data.applied, `pidió confirmación en vez de aplicarse: ${data.conflict?.message}`);
  return data.applied;
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

/** Espera a que terminen las tareas lanzadas con `after()` de next/server (ver stubs/server.mjs). */
export async function afterDone(): Promise<void> {
  const g = globalThis as unknown as { __pzAfter?: Promise<unknown>[] };
  while (g.__pzAfter?.length) await Promise.all(g.__pzAfter.splice(0));
}

/** Espera a que alguna conexión de la base quede bloqueada esperando un candado (la acción ya llegó a la transacción y
 *  espera a otra que sigue abierta). Las pruebas con base van de una en una, así que la que espera es la de la prueba. */
export async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const [row] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row && row.n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("la acción no llegó a esperar el candado");
}

/**
 * Ejecuta `fn` con un SMTP que no responde: sin el buzón de pruebas (MAIL_OUTBOX_DIR) y con SMTP_* hacia un puerto
 * cerrado de esta máquina, así que cada envío falla enseguida con un error de conexión de nodemailer (ESOCKET).
 */
export async function withSmtpDown<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["MAIL_OUTBOX_DIR", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.MAIL_OUTBOX_DIR;
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_FROM: "pizarro@example.com" });
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    const { closeMailTransport } = await import("../../src/lib/mail");
    closeMailTransport();
  }
}

/**
 * Ejecuta `fn` con un servidor de correo de prueba (en esta máquina) que acepta la conexión y rechaza para siempre cada
 * envío en la fase `at`: por defecto cada destinatario con «550 5.1.1» (un buzón que no existe; nodemailer falla con
 * EENVELOPE, `command` «RCPT TO» y responseCode 550); con «MAIL FROM», el remitente (553); con «DATA», el mensaje (554).
 */
export async function withSmtpRejecting<T>(fn: () => Promise<T>, at: "RCPT TO" | "MAIL FROM" | "DATA" = "RCPT TO"): Promise<T> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 prueba ESMTP\r\n");
    let buf = "";
    let inData = false;
    socket.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (inData) {
          if (raw === ".") {
            inData = false;
            socket.write("554 5.7.1 Mensaje rechazado\r\n");
          }
          continue;
        }
        const line = raw.trim().toUpperCase();
        if (line.startsWith("EHLO") || line.startsWith("HELO")) socket.write("250 prueba\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write(at === "MAIL FROM" ? "553 5.7.1 Remitente no admitido\r\n" : "250 2.1.0 Ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write(at === "RCPT TO" ? "550 5.1.1 No existe ese buzón\r\n" : "250 2.1.5 Ok\r\n");
        else if (line === "DATA") {
          inData = true;
          socket.write("354 Adelante\r\n");
        } else if (line.startsWith("QUIT")) socket.end("221 Adiós\r\n");
        else socket.write("250 Ok\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const keys = ["MAIL_OUTBOX_DIR", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.MAIL_OUTBOX_DIR;
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_FROM: "pizarro@example.com" });
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    const { closeMailTransport } = await import("../../src/lib/mail");
    closeMailTransport();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
