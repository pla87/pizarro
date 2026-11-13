// «Borrar mi cuenta» (Mi perfil) y el borrado común con «Administración → Usuarios», contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser, restoreSession, saveSession, SESSION_EXPIRED } from "./helpers";
import { deleteMyAccount, sendAccountDeleteCode } from "../../src/actions/profile";
import { deleteUser } from "../../src/actions/users";
import { getCurrentUser } from "../../src/lib/session";
import { hashPassword } from "../../src/lib/password";
import { encryptSecret } from "../../src/lib/crypto";
import { accountDeleteChallenge, replaceRecoveryCodes } from "../../src/lib/two-factor";
import { generateTotpSecret, hashEmailCode, totpAt } from "../../src/lib/two-factor-core";
import { loadTaskHistory } from "../../src/lib/task-events";
import { flushLogs } from "../../src/lib/log";
import { eraseUser } from "../../src/lib/user-delete";
import { ADMINS_LOCK_NAME } from "../../src/lib/advisory-locks";
import { makeT } from "../../src/i18n/core";

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
      let both: Promise<PromiseSettledResult<void>[]> | null = null;
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMINS_LOCK_NAME}))::text`;
        both = Promise.allSettled([eraseUser(a.id, [], { self: true }), eraseUser(b.id, [], { self: true })]);
        await lockWaiters(2);
      }, { timeout: 10_000 });
      const results = await both!;
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.match(String(failed.reason?.message), /único administrador/);
    });
    assert.equal((await gone(a.id)) !== (await gone(b.id)), true);
  });

  test("contraseña incorrecta: no se borra, y a los 5 intentos se corta", async () => {
    const u = await member();
    for (let i = 0; i < 5; i++) expectFail(await deleteMyAccount({ password: "no-es-esta-clave" }), /contraseña actual no es correcta/);
    expectFail(await deleteMyAccount({ password: PASSWORD }), /Demasiados intentos/);
    assert.equal(await gone(u.id), false);
  });

  test("con proyectos privados propios hay que confirmarlo; los compartidos se quedan sin la persona", async () => {
    const u = await member();
    const other = await makeUser();
    const solo = await makeProject({ visibility: "PRIVATE", owner: u });
    const shared = await makeProject({ visibility: "PRIVATE", owner: u, members: [other] });
    await makeTask(solo);
    expectFail(await deleteMyAccount({ password: PASSWORD }), /proyectos privados/);
    assert.equal(await gone(u.id), false);
    expectOk(await deleteMyAccount({ password: PASSWORD, confirmPrivate: true }));
    assert.equal(await db.project.count({ where: { id: solo.project.id } }), 0);
    assert.equal(await db.task.count({ where: { projectId: solo.project.id } }), 0);
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: shared.project.id } })).map((m) => m.userId), [other.id]);
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
    expectOk(await deleteUser(u.id, false));
    assert.ok(await gone(u.id));
    assert.equal(await db.taskEvent.count({ where: { userName: u.name } }), 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).createdById, null);
  });
});
