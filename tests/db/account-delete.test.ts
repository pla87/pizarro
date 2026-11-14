// «Borrar mi cuenta» (Mi perfil) y el borrado común con «Administración → Usuarios», contra PostgreSQL real.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, restoreSession, saveSession, SESSION_EXPIRED } from "./helpers";
import { deleteMyAccount, sendAccountDeleteCode } from "../../src/actions/profile";
import { deleteUser } from "../../src/actions/users";
import { getCurrentUser } from "../../src/lib/session";
import { hashPassword } from "../../src/lib/password";
import { encryptSecret } from "../../src/lib/crypto";
import { accountDeleteChallenge, confirmAccountDeleteWithGoogle, replaceRecoveryCodes } from "../../src/lib/two-factor";
import { currentSessionId } from "../../src/lib/session";
import { GET as googleStart } from "../../src/app/api/auth/google/start/route";
import { GET as googleCallback } from "../../src/app/api/auth/google/callback/route";
import { generateTotpSecret, hashEmailCode, totpAt } from "../../src/lib/two-factor-core";
import { loadTaskHistory } from "../../src/lib/task-events";
import { flushLogs } from "../../src/lib/log";
import { eraseUser } from "../../src/lib/user-delete";
import { ADMINS_LOCK_NAME } from "../../src/lib/advisory-locks";
import { makeT } from "../../src/i18n/core";
import { visibleProjectsWhere } from "../../src/lib/access";
import type { CurrentUser } from "../../src/lib/session";

const PASSWORD = "una-clave-larga-1";
const hash = await hashPassword(PASSWORD);

/** Miembro con contraseña conocida y sesión abierta. */
async function member(opts: { role?: "ADMIN" | "MEMBER" } = {}) {
  const u = await makeUser(opts);
  await db.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
  await loginAs(u);
  return u;
}

/** Espera a que `n` conexiones estén esperando un candado. */
async function lockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const [row] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row && row.n >= n) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("los borrados no llegaron a esperar el candado");
}

const gone = async (id: string) => (await db.user.count({ where: { id } })) === 0;

/** Desactiva un rato a los demás administradores activos (las pruebas comparten base) y los reactiva al terminar. */
async function aloneAsAdmin<T>(adminId: string, fn: () => Promise<T>): Promise<T> {
  const others = await db.user.findMany({ where: { role: "ADMIN", active: true, id: { not: adminId } }, select: { id: true } });
  await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: false } });
  try {
    return await fn();
  } finally {
    await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { active: true } });
  }
}

describe("borrar mi cuenta", () => {
  test("el último administrador activo no puede borrarse; con otro administrador, sí", async () => {
    const admin = await member({ role: "ADMIN" });
    await makeUser(); // no es la única cuenta (eso lo prueba tests/account-delete.test.ts)
    await aloneAsAdmin(admin.id, async () => {
      expectFail(await deleteMyAccount({ password: PASSWORD }), /único administrador/);
      // Un administrador desactivado no cuenta.
      await makeUser({ role: "ADMIN", active: false });
      expectFail(await deleteMyAccount({ password: PASSWORD }), /único administrador/);
      assert.equal(await gone(admin.id), false);
      await makeUser({ role: "ADMIN" });
      expectOk(await deleteMyAccount({ password: PASSWORD }));
    });
    assert.ok(await gone(admin.id));
  });

  test("dos administradores que se borran a la vez: solo uno lo consigue", async () => {
    const a = await makeUser({ role: "ADMIN" });
    const b = await makeUser({ role: "ADMIN" });
    await aloneAsAdmin(a.id, async () => {
      // aloneAsAdmin también ha desactivado a b: se vuelve a activar para la prueba.
      await db.user.update({ where: { id: b.id }, data: { active: true } });
      // Directamente el borrado común (las acciones comparten el tarro de cookies de las pruebas). La prueba tiene el
      // candado de los administradores mientras los dos borrados llegan a esperarlo: así van a la vez de verdad.
      // Cada uno tiene historial de deshacer y una exportación: quien no consigue borrarse los conserva.
      const f = await makeProject({ members: [a, b] });
      for (const u of [a, b]) {
        await db.undoEntry.create({ data: { userId: u.id, projectId: f.project.id, label: "Algo", ops: [] } });
        // Terminada (no en cola: si no, la recogería el trabajador de las transferencias de otras pruebas).
        await db.projectTransferJob.create({ data: { kind: "EXPORT", status: "DONE", userId: u.id, projectId: f.project.id } });
      }
      let both: Promise<PromiseSettledResult<unknown>[]> | null = null;
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMINS_LOCK_NAME}))::text`;
        both = Promise.allSettled([eraseUser(a.id, { self: true }), eraseUser(b.id, { self: true })]);
        await lockWaiters(2);
      }, { timeout: 10_000 });
      const results = await both!;
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.match(String(failed.reason?.message), /único administrador/);
      const stays = (await gone(a.id)) ? b : a;
      assert.equal(await db.undoEntry.count({ where: { userId: stays.id } }), 1, "la baja que no ocurre no le quita el deshacer");
      assert.equal(await db.projectTransferJob.count({ where: { userId: stays.id } }), 1, "ni sus exportaciones");
      await db.projectTransferJob.deleteMany({ where: { userId: stays.id } });
    });
    assert.equal((await gone(a.id)) !== (await gone(b.id)), true);
  });

  test("contraseña incorrecta: no se borra, y a los 5 intentos se corta", async () => {
    const u = await member();
    for (let i = 0; i < 5; i++) expectFail(await deleteMyAccount({ password: "no-es-esta-clave" }), /contraseña actual no es correcta/);
    expectFail(await deleteMyAccount({ password: PASSWORD }), /Demasiados intentos/);
    assert.equal(await gone(u.id), false);
  });

  test("sus proyectos privados sin más miembros pasan a ser de equipo (lo ven los administradores); los compartidos, sin la persona", async () => {
    const u = await member();
    const other = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const solo = await makeProject({ visibility: "PRIVATE", owner: u });
    const shared = await makeProject({ visibility: "PRIVATE", owner: u, members: [other] });
    const task = await makeTask(solo);
    // Antes, el administrador no lo ve.
    assert.equal(await db.project.count({ where: { id: solo.project.id, ...visibleProjectsWhere({ id: admin.id, role: "ADMIN" } as CurrentUser) } }), 0);
    expectOk(await deleteMyAccount({ password: PASSWORD }));
    assert.ok(await gone(u.id));
    const p = await db.project.findUniqueOrThrow({ where: { id: solo.project.id }, select: { isPrivate: true, privateOwnerId: true, _count: { select: { members: true } } } });
    assert.deepEqual([p.isPrivate, p.privateOwnerId, p._count.members], [false, null, 0], "de equipo, sin miembros");
    assert.equal(await db.task.count({ where: { id: task.id } }), 1, "con todo lo que tenía");
    assert.equal(await db.project.count({ where: { id: solo.project.id, ...visibleProjectsWhere({ id: admin.id, role: "ADMIN" } as CurrentUser) } }), 1, "ahora lo ven los administradores");
    // El compartido sigue privado, con el otro miembro.
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: shared.project.id } })).isPrivate, true);
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: shared.project.id } })).map((m) => m.userId), [other.id]);
    // Y queda en el registro de actividad.
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "users.privateProjectToTeam", projectId: solo.project.id } });
    assert.match(log.message, new RegExp(`pasa a ser de equipo al borrarse la cuenta de «${u.name}»`));
    const action = await db.appLog.findFirstOrThrow({ where: { action: "profile.deleteMyAccount", level: "info" }, orderBy: { createdAt: "desc" } });
    assert.match(action.message, /proyecto privado .* pasa a ser de equipo/);
  });

  test("«Borrar también estos proyectos»: se borran los marcados que siguen sin más miembros; el resto, de equipo", async () => {
    const u = await member();
    const other = await makeUser();
    const a = await makeProject({ visibility: "PRIVATE", owner: u });
    const b = await makeProject({ visibility: "PRIVATE", owner: u });
    const joined = await makeProject({ visibility: "PRIVATE", owner: u });
    await makeTask(a);
    // Entre el diálogo y la confirmación alguien se une a uno de los marcados: no se borra.
    await db.projectMember.create({ data: { projectId: joined.project.id, userId: other.id } });
    expectOk(await deleteMyAccount({ password: PASSWORD, deleteProjects: [a.project.id, joined.project.id] }));
    assert.equal(await db.project.count({ where: { id: a.project.id } }), 0);
    assert.equal(await db.task.count({ where: { projectId: a.project.id } }), 0);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: b.project.id } })).isPrivate, false, "el no marcado pasa a ser de equipo");
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: joined.project.id } })).isPrivate, true, "el que ya tiene otro miembro sigue privado");
  });

  test("Administración → Usuarios: la misma regla y la misma casilla", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const keep = await makeProject({ visibility: "PRIVATE", owner: u });
    await loginAs(admin);
    expectOk(await deleteUser(u.id));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: keep.project.id } })).isPrivate, false);
    const v = await makeUser();
    const drop = await makeProject({ visibility: "PRIVATE", owner: v });
    const stay = await makeProject({ visibility: "PRIVATE", owner: v });
    expectOk(await deleteUser(v.id, [drop.project.id]));
    assert.equal(await db.project.count({ where: { id: drop.project.id } }), 0);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: stay.project.id } })).isPrivate, false);
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "users.privateProjectToTeam", projectId: stay.project.id } });
    assert.equal(log.userId, admin.id, "anotado a nombre de quien borra");
  });

  test("2FA con app: sin código o con uno incorrecto no se borra; con el de la app, sí", async () => {
    const u = await member();
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: u.id }, data: { twoFactorMethod: "TOTP", totpSecretEnc: encryptSecret(secret) } });
    expectFail(await deleteMyAccount({ password: PASSWORD }), /código de verificación/);
    // Contraseña mal, aunque el código esté bien: no se mira el código.
    expectFail(await deleteMyAccount({ password: "no-es-esta-clave", code: totpAt(secret, Date.now()) }), /contraseña actual no es correcta/);
    expectFail(await deleteMyAccount({ password: PASSWORD, code: "000000" === totpAt(secret, Date.now()) ? "111111" : "000000" }), /Código incorrecto/);
    assert.equal(await gone(u.id), false);
    expectOk(await deleteMyAccount({ password: PASSWORD, code: totpAt(secret, Date.now()) }));
    assert.ok(await gone(u.id));
  });

  test("2FA: vale un código de recuperación, y el código por email del propio desafío", async () => {
    const u = await member();
    await db.user.update({ where: { id: u.id }, data: { twoFactorMethod: "TOTP", totpSecretEnc: encryptSecret(generateTotpSecret()) } });
    const [code] = await replaceRecoveryCodes(u.id);
    expectOk(await deleteMyAccount({ password: PASSWORD, code: code! }));
    assert.ok(await gone(u.id));

    const e = await member();
    await db.user.update({ where: { id: e.id }, data: { twoFactorMethod: "EMAIL" } });
    // Sin SMTP no se puede pedir el código...
    expectFail(await sendAccountDeleteCode(), /emails no está configurado/);
    // ...así que se simula el envío: el desafío guarda la huella del código, como sendEmailCode.
    const ch = await accountDeleteChallenge(e.id);
    await db.loginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashEmailCode(ch.id, "123456"), codeExpiresAt: new Date(Date.now() + 60_000) } });
    expectFail(await deleteMyAccount({ password: PASSWORD, code: "654321" }), /Código incorrecto/);
    expectOk(await deleteMyAccount({ password: PASSWORD, code: "123456" }));
    assert.ok(await gone(e.id));
    // El desafío no sirve para el acceso: cae con la cuenta.
    assert.equal(await db.loginChallenge.count({ where: { id: ch.id } }), 0);
  });

  test("2FA: a los 5 códigos incorrectos el desafío se destruye", async () => {
    const u = await member();
    await db.user.update({ where: { id: u.id }, data: { twoFactorMethod: "EMAIL" } });
    const ch = await accountDeleteChallenge(u.id);
    await db.loginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashEmailCode(ch.id, "123456"), codeExpiresAt: new Date(Date.now() + 60_000) } });
    // El límite de contraseñas (5 por 15 min) se alcanza a la vez: se usa una sola ronda de 4 + el bloqueo.
    for (let i = 0; i < 4; i++) expectFail(await deleteMyAccount({ password: PASSWORD, code: "000001" }), /Código incorrecto/);
    expectFail(await deleteMyAccount({ password: PASSWORD, code: "000002" }), /Empieza de nuevo/);
    assert.equal(await db.loginChallenge.count({ where: { id: ch.id } }), 0);
    assert.equal(await gone(u.id), false);
  });

  test("lo que creó se conserva sin autor ni nombre; lo suyo se borra y se cierran todas sus sesiones", async () => {
    const u = await member();
    const other = await makeUser();
    const f = await makeProject({ members: [u, other] });
    const task = await makeTask(f, { createdById: u.id });
    await db.task.update({ where: { id: task.id }, data: { assigneeId: u.id } });
    const comment = await db.taskComment.create({ data: { taskId: task.id, authorId: u.id, body: "Hecho" } });
    await db.taskEvent.create({ data: { taskId: task.id, projectId: f.project.id, userId: u.id, userName: u.name, code: "update", label: "Cambió algo" } });
    await db.taskEvent.create({ data: { taskId: task.id, projectId: f.project.id, userId: other.id, userName: other.name, code: "update", label: "Otro cambio" } });
    await db.notification.create({ data: { userId: other.id, actorId: u.id, taskId: task.id, excerpt: "x" } });
    await db.notification.create({ data: { userId: u.id, actorId: other.id, taskId: task.id, excerpt: "y" } });
    await db.taskFollower.create({ data: { taskId: task.id, userId: u.id } });
    await db.calendarFeed.create({ data: { userId: u.id, tokenHash: `t-${u.id}` } });
    await db.userChannel.create({ data: { userId: u.id, channel: "TELEGRAM", address: "1" } });
    await replaceRecoveryCodes(u.id);
    // Otra sesión abierta en otro dispositivo.
    const thisDevice = saveSession();
    await loginAs(u);
    const otherDevice = saveSession();
    assert.equal(await db.session.count({ where: { userId: u.id } }), 2);

    restoreSession(thisDevice);
    expectOk(await deleteMyAccount({ password: PASSWORD }));
    assert.ok(await gone(u.id));
    // Sesiones: ninguna fila, la cookie de este navegador borrada y la del otro dispositivo ya no vale.
    assert.equal(await db.session.count({ where: { userId: u.id } }), 0);
    assert.equal(await getCurrentUser(), null);
    restoreSession(otherDevice);
    assert.equal(await getCurrentUser(), null);
    expectFail(await deleteMyAccount({ password: PASSWORD }), SESSION_EXPIRED);

    // Se conserva, sin autor.
    const t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(t.createdById, null);
    assert.equal(t.assigneeId, null);
    assert.equal((await db.taskComment.findUniqueOrThrow({ where: { id: comment.id } })).authorId, null);
    assert.equal((await db.notification.findFirstOrThrow({ where: { userId: other.id, taskId: task.id } })).actorId, null);
    // Su nombre no queda en el historial; el de los demás, sí.
    assert.equal(await db.taskEvent.count({ where: { userName: u.name } }), 0);
    const history = await loadTaskHistory(task.id, makeT("es"));
    assert.deepEqual(history.map((h) => h.userName).sort(), [other.name, "Usuario eliminado"].sort());
    assert.ok((await loadTaskHistory(task.id, makeT("en"))).some((h) => h.userName === "Deleted user"));
    // Lo suyo, fuera.
    assert.equal(await db.notification.count({ where: { userId: u.id } }), 0);
    assert.equal(await db.taskFollower.count({ where: { userId: u.id } }), 0);
    assert.equal(await db.calendarFeed.count({ where: { userId: u.id } }), 0);
    assert.equal(await db.userChannel.count({ where: { userId: u.id } }), 0);
    assert.equal(await db.recoveryCode.count({ where: { userId: u.id } }), 0);
    assert.equal(await db.projectMember.count({ where: { userId: u.id } }), 0);
    // Y queda en el registro quién se fue.
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "profile.deleteMyAccount", level: "info" }, orderBy: { createdAt: "desc" } });
    assert.match(log.message, new RegExp(`«${u.name}» borró su cuenta`));
  });

  test("el borrado desde Administración usa el mismo camino: también vacía su nombre del historial", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    const task = await makeTask(f, { createdById: u.id });
    await db.taskEvent.create({ data: { taskId: task.id, projectId: f.project.id, userId: u.id, userName: u.name, code: "update", label: "Cambió algo" } });
    await loginAs(admin);
    expectOk(await deleteUser(u.id));
    assert.ok(await gone(u.id));
    assert.equal(await db.taskEvent.count({ where: { userName: u.name } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).createdById, null);
  });
});

// --- Sin contraseña conocida: quien entra con Google -------------------------------------------------------------------

const ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MAIL_OUTBOX_DIR", "AUTH_GOOGLE_ONLY", "AUTH_ALLOW_ADMIN_PASSWORD"] as const;
const CLIENT_ID = "pizarro-tests.apps.example.com";

/** Cuenta invitada que entra con Google: su contraseña es la provisional aleatoria, que nadie conoce. */
async function googleMember(opts: { totp?: string } = {}) {
  const u = await makeUser();
  await db.user.update({
    where: { id: u.id },
    data: {
      passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
      googleSub: `sub-${u.id}`,
      ...(opts.totp ? { twoFactorMethod: "TOTP" as const, totpSecretEnc: encryptSecret(opts.totp) } : {}),
    },
  });
  await loginAs(u);
  return u;
}

/** Simula el email del código: el desafío guarda la huella de un código conocido (como sendEmailCode). */
async function knownEmailCode(userId: string, code = "123456") {
  const ch = await accountDeleteChallenge(userId);
  await db.loginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashEmailCode(ch.id, code), codeExpiresAt: new Date(Date.now() + 60_000) } });
  return ch;
}

describe("borrar la cuenta sin contraseña conocida (entra con Google)", () => {
  const saved: Partial<Record<(typeof ENV)[number], string>> = {};
  beforeEach(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "secreto-de-pruebas", MAIL_OUTBOX_DIR: await mkdtemp(path.join(tmpdir(), "pz-baja-")) });
    delete process.env.AUTH_GOOGLE_ONLY;
    delete process.env.AUTH_ALLOW_ADMIN_PASSWORD;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("sin verificación en dos pasos: con el código por email; quien no tiene Google sigue con su contraseña", async () => {
    const g = await googleMember();
    expectFail(await deleteMyAccount({ password: "no-la-conoce-nadie" }), /contraseña actual no es correcta/);
    expectFail(await deleteMyAccount({ method: "code" }), /código de verificación/);
    // «Enviar código» funciona para ella (sin verificación en dos pasos por email).
    expectOk(await sendAccountDeleteCode());
    await knownEmailCode(g.id);
    expectFail(await deleteMyAccount({ method: "code", code: "654321" }), /Código incorrecto/);
    assert.equal(await gone(g.id), false);
    expectOk(await deleteMyAccount({ method: "code", code: "123456" }));
    assert.ok(await gone(g.id));

    // Con contraseña y sin Google: nada cambia (ni código por email ni volver a entrar con Google).
    const p = await member();
    expectFail(await sendAccountDeleteCode(), /no usa códigos por email/);
    await knownEmailCode(p.id);
    expectFail(await deleteMyAccount({ method: "code", code: "123456" }), /Confirma con tu contraseña/);
    await confirmAccountDeleteWithGoogle(p.id, (await currentSessionId())!);
    expectFail(await deleteMyAccount({ method: "google" }), /Confirma con tu contraseña/);
    assert.equal(await gone(p.id), false);
    expectOk(await deleteMyAccount({ password: PASSWORD }));
  });

  test("con la app de verificación (TOTP): su código basta; el email y Google no", async () => {
    const secret = generateTotpSecret();
    const g = await googleMember({ totp: secret });
    expectFail(await sendAccountDeleteCode(), /no usa códigos por email/);
    await confirmAccountDeleteWithGoogle(g.id, (await currentSessionId())!);
    expectFail(await deleteMyAccount({ method: "google" }), /código de tu app/);
    expectFail(await deleteMyAccount({ method: "code", code: "000000" === totpAt(secret, Date.now()) ? "111111" : "000000" }), /Código incorrecto/);
    assert.equal(await gone(g.id), false);
    expectOk(await deleteMyAccount({ method: "code", code: totpAt(secret, Date.now()) }));
    assert.ok(await gone(g.id));
  });

  test("los mismos límites de intentos: 5 códigos mal destruyen el desafío y después se corta", async () => {
    const g = await googleMember();
    await knownEmailCode(g.id);
    for (let i = 0; i < 4; i++) expectFail(await deleteMyAccount({ method: "code", code: "000001" }), /Código incorrecto/);
    expectFail(await deleteMyAccount({ method: "code", code: "000002" }), /Empieza de nuevo/);
    await knownEmailCode(g.id);
    expectFail(await deleteMyAccount({ method: "code", code: "123456" }), /Demasiados intentos/);
    assert.equal(await gone(g.id), false);
  });

  test("volver a entrar con Google: vale para esta sesión y 10 minutos", async () => {
    const g = await googleMember();
    expectFail(await deleteMyAccount({ method: "google" }), /Vuelve a entrar con Google/);
    await confirmAccountDeleteWithGoogle(g.id, "otra-sesion");
    expectFail(await deleteMyAccount({ method: "google" }), /Vuelve a entrar con Google/);
    await confirmAccountDeleteWithGoogle(g.id, (await currentSessionId())!);
    await db.loginChallenge.updateMany({ where: { userId: g.id, kind: "ACCOUNT_DELETE" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectFail(await deleteMyAccount({ method: "google" }), /Vuelve a entrar con Google/);
    assert.equal(await gone(g.id), false);
    await confirmAccountDeleteWithGoogle(g.id, (await currentSessionId())!);
    expectOk(await deleteMyAccount({ method: "google" }));
    assert.ok(await gone(g.id));
  });

  test("con «solo Google» la contraseña no sirve para borrar (como para entrar)", async () => {
    process.env.AUTH_GOOGLE_ONLY = "true";
    const g = await googleMember();
    await db.user.update({ where: { id: g.id }, data: { passwordHash: hash } });
    expectFail(await deleteMyAccount({ password: PASSWORD }), /se entra con Google/);
    await knownEmailCode(g.id);
    expectOk(await deleteMyAccount({ method: "code", code: "123456" }));
  });

  test("iniciar sesión con Google no cambia: basta con elegir la cuenta", async () => {
    const target = (fn: () => Promise<unknown>) => fn().then(() => "", (err: { digest?: string }) => String(err.digest ?? err).split(";")[2] ?? "");
    const to = new URL(await target(() => googleStart(new Request("http://localhost:3000/api/auth/google/start"))));
    assert.equal(to.searchParams.get("prompt"), "select_account");
    assert.equal(to.searchParams.get("max_age"), null);
    const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;
    assert.equal(jar.get("pz_glogin")!.split(".").length, 4, "sin marca ni hora de inicio");
  });

  test("la vuelta de Google: con la misma cuenta enlazada y la contraseña recién escrita confirma (sin abrir otra sesión); con otra cuenta o sin contraseña, no", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k-pruebas", alg: "RS256", use: "sig" };
    /** id_token simulado; `authAgo`: hace cuántos segundos escribió la contraseña en Google (null: sin auth_time). */
    const idToken = (sub: string, nonce: string, authAgo: number | null) => {
      const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const auth = authAgo === null ? {} : { auth_time: now - authAgo };
      const body = `${enc({ alg: "RS256", kid: "k-pruebas", typ: "JWT" })}.${enc({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub, email: "persona@example.com", email_verified: true, nonce, iat: now, exp: now + 600, ...auth })}`;
      return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
    };
    const jar = (globalThis as unknown as { __pzTestRequest: { jar: Map<string, string> } }).__pzTestRequest.jar;
    const realFetch = globalThis.fetch;
    /** Adónde redirige (Next lanza la redirección como error con `digest`). */
    const target = (fn: () => Promise<unknown>) => fn().then(() => "", (err: { digest?: string }) => String(err.digest ?? err).split(";")[2] ?? "");
    /** Inicia «volver a entrar con Google» y vuelve de Google con la cuenta `sub`: adónde lleva la vuelta. */
    const roundTrip = async (sub: string, authAgo: number | null = 2): Promise<string> => {
      const to = new URL(await target(() => googleStart(new Request("http://localhost:3000/api/auth/google/start?purpose=account-delete"))));
      assert.equal(to.origin, "https://accounts.google.com");
      // Google tiene que volver a pedir la contraseña, aunque haya una sesión abierta.
      assert.equal(to.searchParams.get("prompt"), "login");
      assert.equal(to.searchParams.get("max_age"), "0");
      const cookie = jar.get("pz_glogin")!.split(".");
      assert.equal(cookie[5], "account-delete");
      assert.ok(Math.abs(Number(cookie[4]) - Date.now() / 1000) < 5, "con la hora de inicio");
      globalThis.fetch = (async (url: string | URL) => {
        if (String(url).startsWith("https://oauth2.googleapis.com/token")) return Response.json({ id_token: idToken(sub, cookie[1]!, authAgo) });
        if (String(url).startsWith("https://www.googleapis.com/oauth2/v3/certs")) return Response.json({ keys: [jwk] }, { headers: { "cache-control": "max-age=600" } });
        throw new Error(`fetch inesperado: ${url}`);
      }) as typeof fetch;
      try {
        return await target(() => googleCallback(new Request(`http://localhost:3000/api/auth/google/callback?state=${cookie[0]}&code=codigo`)));
      } finally {
        globalThis.fetch = realFetch;
      }
    };

    const g = await googleMember();
    const sessions = await db.session.count({ where: { userId: g.id } });
    assert.equal(await roundTrip("sub-de-otra-persona"), "http://localhost:3000/settings?tab=cuenta&delete=google_mismatch#delete-account");
    expectFail(await deleteMyAccount({ method: "google" }), /Vuelve a entrar con Google/);
    // Con su cuenta pero sin haber escrito la contraseña ahora: sin auth_time, o de una sesión de Google anterior.
    const stale = "http://localhost:3000/settings?tab=cuenta&delete=google_stale#delete-account";
    assert.equal(await roundTrip(`sub-${g.id}`, null), stale);
    assert.equal(await roundTrip(`sub-${g.id}`, 3600), stale);
    assert.equal(await roundTrip(`sub-${g.id}`, 60), stale, "de antes de empezar (más que el margen de los relojes)");
    expectFail(await deleteMyAccount({ method: "google" }), /Vuelve a entrar con Google/);
    await flushLogs();
    assert.ok(await db.appLog.findFirst({ where: { action: "auth.googleReauthFailed", userId: g.id, message: { contains: "sin escribir la contraseña" } } }));
    assert.equal(await roundTrip(`sub-${g.id}`), "http://localhost:3000/settings?tab=cuenta&delete=google#delete-account");
    assert.equal(await db.session.count({ where: { userId: g.id } }), sessions, "no abre otra sesión");
    expectOk(await deleteMyAccount({ method: "google" }));
    assert.ok(await gone(g.id));
  });
});
