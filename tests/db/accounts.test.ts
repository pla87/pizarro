// Miembros de proyectos privados, contraseñas y cambio forzado, contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { afterDone, db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, NOT_FOUND, saveSession, restoreSession, logout, waitForLockWaiter } from "./helpers";
import { addProjectMember, deleteProject, removeProjectMember, updateProject } from "../../src/actions/projects";
import { getTaskDetail, updateTask } from "../../src/actions/tasks";
import { login, requestPasswordReset, resetPassword, setNewPassword } from "../../src/actions/auth";
import * as usersActions from "../../src/actions/users";
import { forcePasswordChange, updateUser } from "../../src/actions/users";
import { getCurrentUser, getPendingUser } from "../../src/lib/session";
import { hashPassword, verifyPassword } from "../../src/lib/password";
import { findUserForGoogle } from "../../src/lib/google-login";
import { completeLogin } from "../../src/lib/login";
import { createResetLink } from "../../src/lib/reset-link";
import { findUsableToken, consumeToken } from "../../src/lib/auth-token";
import { issueAuthToken } from "../../src/lib/auth-token-issue";
import { applyNewPassword } from "../../src/lib/account";
import { LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_LIMIT_TRUSTED, loginRateKeys, rateLimit, rateLimitReached, resetRateLimit } from "../../src/lib/rate-limit";
import { finishSetup, verifyLoginCode } from "../../src/actions/two-factor";
import { hashAuthToken, newToken } from "../../src/lib/auth-token-core";
import { CHALLENGE_COOKIE, readChallenge, sendEmailCode, startChallenge } from "../../src/lib/two-factor";
import { flushLogs } from "../../src/lib/log";
import { changePassword } from "../../src/actions/profile";
import { encryptSecret } from "../../src/lib/crypto";
import { hashFeedToken, newFeedToken } from "../../src/lib/calendar-feed-core";

describe("miembros de proyectos privados", () => {
  test("un miembro añade y quita miembros; quien no lo es recibe «no encontrado»", async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const stranger = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner });

    await loginAs(stranger);
    expectFail(await addProjectMember(p.project.id, friend.id), NOT_FOUND);

    await loginAs(owner);
    expectOk(await addProjectMember(p.project.id, friend.id));
    // Idempotente.
    expectOk(await addProjectMember(p.project.id, friend.id));
    assert.equal(await db.projectMember.count({ where: { projectId: p.project.id } }), 2);

    // El nuevo miembro ya ve el proyecto; el ajeno sigue sin verlo.
    const task = await makeTask(p);
    await loginAs(friend);
    expectOk(await getTaskDetail(task.id));
    await loginAs(stranger);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);

    // Quitar a un miembro lo deja fuera y desasigna sus tarjetas.
    await db.task.update({ where: { id: task.id }, data: { assigneeId: friend.id } });
    await loginAs(owner);
    expectOk(await removeProjectMember(p.project.id, friend.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, null);
    await loginAs(friend);
    expectFail(await getTaskDetail(task.id), NOT_FOUND);
  });

  test("no se puede añadir a un usuario desactivado (a un administrador sí: ver project-members.test.ts)", async () => {
    const owner = await makeUser();
    const inactive = await makeUser({ active: false });
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectFail(await addProjectMember(p.project.id, inactive.id), /Usuario no válido/);
  });

  test("el último miembro no puede salir; con otro miembro sí", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectFail(await removeProjectMember(p.project.id, owner.id), /último miembro/);
    assert.equal(await db.projectMember.count({ where: { projectId: p.project.id } }), 1);

    expectOk(await addProjectMember(p.project.id, other.id));
    expectOk(await removeProjectMember(p.project.id, owner.id));
    assert.deepEqual((await db.projectMember.findMany({ where: { projectId: p.project.id } })).map((m) => m.userId), [other.id]);
    // Ya no es miembro: no puede volver a tocar el proyecto.
    expectFail(await removeProjectMember(p.project.id, other.id), NOT_FOUND);
  });

  test("un miembro desactivado no cuenta como «otro miembro» para dejar salir al último activo", async () => {
    const owner = await makeUser();
    const gone = await makeUser({ active: false });
    const p = await makeProject({ visibility: "PRIVATE", owner, members: [gone] });
    await loginAs(owner);
    expectFail(await removeProjectMember(p.project.id, owner.id), /último miembro/);
  });

  test("un no administrador no puede renombrar ni borrar proyectos no privados; en privados sí, solo con el nombre exacto", async () => {
    const member = await makeUser();
    const pub = await makeProject();
    await loginAs(member);
    expectFail(await updateProject(pub.project.id, { name: "Nuevo", description: "" }), FORBIDDEN);
    expectFail(await deleteProject(pub.project.id, pub.project.name), FORBIDDEN);

    const priv = await makeProject({ visibility: "PRIVATE", owner: member });
    expectOk(await updateProject(priv.project.id, { name: "Renombrado", description: "" }));
    expectFail(await deleteProject(priv.project.id, "otro nombre"), /nombre no coincide/);
    expectOk(await deleteProject(priv.project.id, "Renombrado"));
    assert.equal(await db.project.count({ where: { id: priv.project.id } }), 0);
  });

  test("un administrador ajeno no puede gestionar el privado de otro", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(admin);
    expectFail(await addProjectMember(p.project.id, admin.id), NOT_FOUND);
    expectFail(await deleteProject(p.project.id, p.project.name), NOT_FOUND);
    assert.equal(await db.project.count({ where: { id: p.project.id } }), 1);
  });
});

describe("contraseñas y cambio forzado", () => {
  test("ninguna acción de administración permite fijar la contraseña de otra persona", async () => {
    // La API de usuarios solo ofrece alta (como invitación: contraseña aleatoria que nadie conoce), edición, forzar cambio, 2FA, borrado,
    // reenviar la invitación (el enlace va al email de la persona), generar un enlace de invitación nuevo (sin email: el
    // admin se lo pasa, pero la contraseña la elige la persona) e invitar a un proyecto (cuenta con una contraseña
    // aleatoria que nadie conoce; el enlace de un solo uso es para que la persona elija la suya).
    assert.deepEqual(Object.keys(usersActions).sort(), ["allowGoogleRelink", "createUser", "deleteUser", "forcePasswordChange", "generateInviteLink", "inviteToProject", "resendInvite", "resetUserTwoFactor", "unlinkGoogle", "updateUser"]);

    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const hash = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: hash } });
    await loginAs(admin);
    // Un campo de contraseña colado en updateUser se descarta (esquema estricto de campos conocidos).
    expectOk(await updateUser(target.id, { name: "Otro nombre", email: target.email, role: "MEMBER", active: true, expected: { name: target.name, email: target.email, role: "MEMBER", active: true }, password: "hackeada-12345" } as never));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.passwordHash, hash);
    assert.equal(row.name, "Otro nombre");
  });

  test("forcePasswordChange: marca el cambio, cierra sus sesiones y anula la contraseña actual; solo admins y nunca a uno mismo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const hash = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: hash } });
    await loginAs(target);
    const targetCookie = saveSession();

    await loginAs(target);
    expectFail(await forcePasswordChange(admin.id), FORBIDDEN);

    await loginAs(admin);
    expectFail(await forcePasswordChange(admin.id), /Mi perfil/);
    expectOk(await forcePasswordChange(target.id));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.mustChangePassword, true);
    // La contraseña anterior deja de valer: queda el hash bcrypt de un valor aleatorio que nadie conoce.
    assert.notEqual(row.passwordHash, hash);
    assert.match(row.passwordHash, /^\$2[aby]\$/);
    assert.equal(await verifyPassword("clave-original-123", row.passwordHash), false);
    assert.equal(await db.session.count({ where: { userId: target.id } }), 0);

    // La sesión vieja ya no vale.
    restoreSession(targetCookie);
    assert.equal(await getCurrentUser(), null);
  });

  // Antes la invitación pendiente seguía valiendo hasta 72 h: quien la tuviera elegía la contraseña y entraba, aunque la
  // pantalla dice que se anulan los enlaces pendientes.
  // Una invitación sin aceptar no tiene contraseña que forzar: la interfaz no lo ofrece y el servidor tampoco lo acepta.
  test("forcePasswordChange rechaza una invitación pendiente y la deja como estaba", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser({ mustChangePassword: true });
    const invite = await issueAuthToken(target.id, "INVITE");
    await loginAs(admin);
    expectFail(await forcePasswordChange(target.id, { copyLink: true }), /aún no ha aceptado la invitación/);
    assert.ok(await findUsableToken(invite, ["INVITE"]), "la invitación sigue valiendo");
    assert.equal(await db.authToken.count({ where: { userId: target.id, purpose: "PASSWORD_RESET" } }), 0);
  });

  test("forcePasswordChange anula también un enlace de invitación que quedara pendiente", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    // Ya ha entrado (no es una invitación pendiente), pero le quedaba un enlace de invitación sin usar.
    const target = await makeUser();
    const invite = await issueAuthToken(target.id, "INVITE");
    await loginAs(admin);
    assert.ok(await findUsableToken(invite, ["INVITE"]), "la invitación vale antes de forzar el cambio");
    expectOk(await forcePasswordChange(target.id, { copyLink: true }));
    assert.equal(await findUsableToken(invite, ["INVITE"]), null, "ya no vale");
    assert.equal(await db.authToken.count({ where: { userId: target.id, purpose: "INVITE" } }), 0);
    logout();
    expectFail(await resetPassword(invite, "clave-del-intruso-segura-1"), /no es válido o ha caducado/);
  });

  test("tras forzarlo: la contraseña anterior no entra; con Google se llega a «Elige una contraseña nueva» y, elegida, el enlace deja de valer", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const sub = `google-sub-${target.id}`;
    await db.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword("clave-original-123"), googleSub: sub } });
    await loginAs(admin);
    const { link } = expectOk(await forcePasswordChange(target.id, { copyLink: true })) as { link: string | null };
    const before = (await db.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash;

    // 1) Con la contraseña que conocía (la persona o quien se la hubiera sacado) ya no se entra.
    logout();
    const form = new FormData();
    form.set("email", target.email);
    form.set("password", "clave-original-123");
    const res = await login({}, form);
    assert.equal(res.error, "Credenciales incorrectas.");
    assert.equal(await db.session.count({ where: { userId: target.id } }), 0);

    // 2) Con Google (cuenta enlazada) sí entra, pero la sesión queda pendiente de elegir contraseña: solo ve /change-password.
    const viaGoogle = await findUserForGoogle({ sub, email: target.email, name: null });
    assert.ok(viaGoogle && viaGoogle !== "relink_blocked");
    assert.equal(viaGoogle.mustChangePassword, true);
    await completeLogin(viaGoogle, { method: "google", path: "/api/auth/google/callback" });
    assert.equal(await getCurrentUser(), null);
    assert.equal((await getPendingUser())?.id, target.id);
    // Cualquier contraseña válida es «distinta de la actual» (nadie conoce la aleatoria); al elegirla ya entra.
    expectOk(await setNewPassword("clave-nueva-tras-google-1"));
    assert.equal((await getCurrentUser())?.id, target.id);
    const chosen = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(chosen.mustChangePassword, false);
    assert.notEqual(chosen.passwordHash, before);

    // 3) Elegida la contraseña, el enlace generado al forzar deja de valer (applyNewPassword anula los pendientes).
    logout();
    expectFail(await resetPassword(link!.split("/reset/")[1]!, "clave-del-enlace-segura-2"), /no es válido o ha caducado/);
  });

  test("con el cambio pendiente (sesión viva) las acciones quedan bloqueadas y solo se puede elegir la contraseña nueva", async () => {
    const target = await makeUser({ mustChangePassword: true });
    const old = await hashPassword("clave-original-123");
    await db.user.update({ where: { id: target.id }, data: { passwordHash: old } });
    const p = await makeProject();
    const task = await makeTask(p);
    await loginAs(target);

    assert.equal(await getCurrentUser(), null);
    assert.equal((await getPendingUser())?.id, target.id);
    expectFail(await getTaskDetail(task.id), /elegir una contraseña nueva/);
    expectFail(await updateTask(task.id, { title: "x" }), /elegir una contraseña nueva/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, task.title);

    // La nueva contraseña debe ser distinta; al elegirla, la marca desaparece y las acciones vuelven a funcionar.
    expectFail(await setNewPassword("clave-original-123"), /distinta de la actual/);
    expectOk(await setNewPassword("clave-nueva-segura-456"));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.mustChangePassword, false);
    assert.notEqual(row.passwordHash, old);
    expectOk(await getTaskDetail(task.id));
  });

  test("un usuario normal no puede forzar cambios ni editar usuarios", async () => {
    const member = await makeUser();
    const other = await makeUser();
    await loginAs(member);
    expectFail(await forcePasswordChange(other.id), FORBIDDEN);
    expectFail(await updateUser(other.id, { name: "x", email: other.email, role: "ADMIN", active: true, expected: { name: other.name, email: other.email, role: "MEMBER", active: true } }), FORBIDDEN);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role, "MEMBER");
  });
});

describe("enlaces pendientes al cambiar la contraseña", () => {
  const pending = (userId: string) => db.authToken.count({ where: { userId, purpose: { in: ["EMAIL_CHANGE", "PASSWORD_CHANGE", "INVITE"] } } });

  test("cambiar o restablecer la contraseña anula un cambio de email pendiente (pedido por quien conocía la anterior)", async () => {
    const victim = await makeUser();
    await issueAuthToken(victim.id, "EMAIL_CHANGE", { email: "atacante@example.com" });
    assert.equal(await pending(victim.id), 1);
    await applyNewPassword(victim.id, await hashPassword("una-clave-nueva-larga-1"), { notice: false });
    assert.equal(await pending(victim.id), 0);
  });

  test("forzar el cambio de contraseña también anula los cambios de email pendientes", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const victim = await makeUser();
    await issueAuthToken(victim.id, "EMAIL_CHANGE", { email: "atacante@example.com" });
    await loginAs(admin);
    expectOk(await forcePasswordChange(victim.id, { copyLink: true }));
    assert.equal(await db.authToken.count({ where: { userId: victim.id, purpose: "EMAIL_CHANGE" } }), 0);
    // Queda solo el enlace nuevo de restablecimiento.
    assert.equal(await db.authToken.count({ where: { userId: victim.id, purpose: "PASSWORD_RESET" } }), 1);
  });

  test("desactivar a alguien borra sus enlaces pendientes (no «reviven» al reactivar)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    await issueAuthToken(u.id, "EMAIL_CHANGE", { email: "otra@example.com" });
    await loginAs(admin);
    expectOk(await updateUser(u.id, { name: u.name, email: u.email, role: "MEMBER", active: false, expected: { name: u.name, email: u.email, role: "MEMBER", active: true } }));
    assert.equal(await db.authToken.count({ where: { userId: u.id } }), 0);
  });
});

describe("enlace de restablecimiento sin email", () => {
  const tokenOf = (url: string) => url.split("/reset/")[1]!;

  test("el admin obtiene un enlace de un solo uso para otra persona, no para sí mismo, y el token no queda en claro", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    await loginAs(admin);
    expectFail(await forcePasswordChange(admin.id, { copyLink: true }), /Mi perfil/);
    const res = expectOk(await forcePasswordChange(target.id, { copyLink: true })) as { link: string | null };
    assert.match(res.link ?? "", /\/reset\/[\w-]{20,}$/);
    const token = tokenOf(res.link!);
    const row = await db.authToken.findFirstOrThrow({ where: { userId: target.id, purpose: "PASSWORD_RESET" } });
    assert.notEqual(row.tokenHash, token);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).mustChangePassword, true);

    const usable = await findUsableToken(token, ["PASSWORD_RESET"]);
    assert.equal(usable?.userId, target.id);
    assert.equal(await consumeToken(usable!.id), true);
    // Una segunda vez ya no sirve.
    assert.equal(await consumeToken(usable!.id), false);
    assert.equal(await findUsableToken(token, ["PASSWORD_RESET"]), null);

    const member = await makeUser();
    await loginAs(member);
    expectFail(await forcePasswordChange(target.id, { copyLink: true }), FORBIDDEN);
  });

  test("el enlace caduca a los 30 minutos", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    await loginAs(admin);
    const res = expectOk(await forcePasswordChange(target.id, { copyLink: true })) as { link: string | null };
    const row = await db.authToken.findFirstOrThrow({ where: { userId: target.id, purpose: "PASSWORD_RESET" } });
    const mins = (row.expiresAt.getTime() - Date.now()) / 60_000;
    assert.ok(mins > 29 && mins <= 30, `caduca en ${mins} min`);
    await db.authToken.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await findUsableToken(tokenOf(res.link!), ["PASSWORD_RESET"]), null);
  });

  test("createResetLink (CLI): genera el enlace, rechaza desactivados y desconocidos, y solo borra el 2FA con reset2fa", async () => {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { twoFactorMethod: "TOTP", totpSecretEnc: "x" } });
    const a = await createResetLink(user.email.toUpperCase(), { appUrl: "https://app.example.com/" });
    assert.ok(a.ok && a.url.startsWith("https://app.example.com/reset/") && !a.twoFactorCleared);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorMethod, "TOTP");
    const b = await createResetLink(user.email!, { appUrl: "https://app.example.com", reset2fa: true });
    assert.ok(b.ok && b.twoFactorCleared);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorMethod, null);
    // El enlace nuevo sustituye al anterior.
    assert.equal(await findUsableToken(tokenOf((a as { url: string }).url), ["PASSWORD_RESET"]), null);
    assert.equal((await findUsableToken(tokenOf((b as { url: string }).url), ["PASSWORD_RESET"]))?.userId, user.id);

    const off = await makeUser({ active: false });
    const c = await createResetLink(off.email!, { appUrl: "https://app.example.com" });
    assert.ok(!c.ok && /desactivado/.test(c.error));
    assert.equal(await db.authToken.count({ where: { userId: off.id } }), 0);
    const d = await createResetLink("nadie@example.com", { appUrl: "https://app.example.com" });
    assert.ok(!d.ok);
  });

  test("createResetLink (CLI): deja rastro en el registro de actividad, sin el token", async () => {
    const user = await makeUser({ name: "Persona Uno" });
    await db.appLog.deleteMany({ where: { action: "auth.resetLinkCli" } });
    const a = await createResetLink(user.email!, { appUrl: "https://app.example.com" });
    const b = await createResetLink(user.email!, { appUrl: "https://app.example.com", reset2fa: true });
    assert.ok(a.ok && b.ok);
    const rows = await db.appLog.findMany({ where: { action: "auth.resetLinkCli" }, orderBy: { createdAt: "asc" } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.category === "auth" && r.level === "info" && r.userId === user.id));
    assert.equal(rows[0]!.message, "Enlace de restablecimiento generado desde la consola para «Persona Uno»");
    assert.equal(rows[1]!.message, "Enlace de restablecimiento generado desde la consola para «Persona Uno» y verificación en dos pasos reiniciada");
    const dump = JSON.stringify(rows);
    for (const r of [a, b]) assert.equal(dump.includes(tokenOf((r as { url: string }).url)), false);
    // Un fallo (usuario desconocido) no deja rastro.
    await createResetLink("nadie@example.com", { appUrl: "https://app.example.com" });
    assert.equal(await db.appLog.count({ where: { action: "auth.resetLinkCli" } }), 2);
  });
});

describe("accesos a medio completar (segundo paso pendiente) al cambiar la contraseña", () => {
  const halfDone = (userId: string) => db.loginChallenge.count({ where: { userId, kind: { in: ["LOGIN", "SETUP"] } } });
  /** Lo que lanza redirect() (stub de next/navigation): la URL de destino. */
  const redirectTo = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (e) {
      const digest = String((e as { digest?: string }).digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2]!;
      throw e;
    }
    throw new Error("no ha redirigido");
  };

  /**
   * Dos navegadores a medio entrar en la cuenta (contraseña ya comprobada): uno en el segundo paso (LOGIN) y otro que
   * ya confirmó el alta del método y solo le falta abrir la sesión (SETUP confirmado). Devuelve las cookies de cada uno.
   */
  async function twoPending(userId: string) {
    logout();
    await startChallenge(userId, "LOGIN");
    const loginCookie = saveSession();
    // startChallenge deja uno por persona: el segundo se crea a mano, con su propia cookie.
    const token = newToken();
    await db.loginChallenge.create({ data: { userId, kind: "SETUP", tokenHash: hashAuthToken(token), confirmed: true, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    const setupCookie = new Map([[CHALLENGE_COOKIE, token]]);
    restoreSession(setupCookie);
    assert.equal((await readChallenge())?.kind, "SETUP");
    restoreSession(loginCookie);
    assert.equal((await readChallenge())?.kind, "LOGIN");
    assert.equal(await halfDone(userId), 2);
    return { loginCookie, setupCookie };
  }

  /** Ninguno de los dos puede terminar de entrar: ni el código del segundo paso ni «Continuar» tras los códigos. */
  async function cannotFinish(userId: string, c: Awaited<ReturnType<typeof twoPending>>) {
    assert.equal(await halfDone(userId), 0);
    restoreSession(c.loginCookie);
    assert.equal(await readChallenge(), null);
    const form = new FormData();
    form.set("code", "123456");
    assert.equal(await redirectTo(() => verifyLoginCode({}, form)), "/login?error=twofactor_expired");
    restoreSession(c.setupCookie);
    assert.equal(await readChallenge(), null);
    assert.equal(await redirectTo(() => finishSetup()), "/login");
    assert.equal(await db.session.count({ where: { userId } }), 0);
    logout();
  }

  test("forzar el cambio de contraseña anula los accesos a medio completar", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser({ role: "ADMIN" });
    const c = await twoPending(target.id);
    await loginAs(admin);
    expectOk(await forcePasswordChange(target.id, { copyLink: true }));
    await cannotFinish(target.id, c);
  });

  test("restablecer la contraseña con el enlace también los anula", async () => {
    const target = await makeUser({ role: "ADMIN" });
    const c = await twoPending(target.id);
    const token = await issueAuthToken(target.id, "PASSWORD_RESET");
    logout();
    expectOk(await resetPassword(token, "clave-restablecida-segura-1"));
    await cannotFinish(target.id, c);
  });

  test("restablecer la contraseña levanta el bloqueo de la cuenta por intentos fallidos", async () => {
    const target = await makeUser();
    const key = loginRateKeys("203.0.113.7", target.email).account;
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT_TRUSTED; i++) rateLimit(key, LOGIN_ACCOUNT_LIMIT_TRUSTED, 15 * 60_000);
    assert.ok(rateLimitReached(key, LOGIN_ACCOUNT_LIMIT));
    const token = await issueAuthToken(target.id, "PASSWORD_RESET");
    logout();
    expectOk(await resetPassword(token, "clave-restablecida-segura-2"));
    assert.equal(rateLimitReached(key, LOGIN_ACCOUNT_LIMIT), false);
  });

  test("cambiarla desde la app (applyNewPassword), desactivar la cuenta o desvincular Google, igual", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const a = await makeUser({ role: "ADMIN" });
    const ca = await twoPending(a.id);
    await applyNewPassword(a.id, await hashPassword("una-clave-nueva-larga-2"), { notice: false });
    await cannotFinish(a.id, ca);

    const b = await makeUser();
    const cb = await twoPending(b.id);
    await loginAs(admin);
    expectOk(await updateUser(b.id, { name: b.name, email: b.email, role: "MEMBER", active: false, expected: { name: b.name, email: b.email, role: "MEMBER", active: true } }));
    await cannotFinish(b.id, cb);

    const g = await makeUser();
    await db.user.update({ where: { id: g.id }, data: { googleSub: `google-sub-${g.id}` } });
    const cg = await twoPending(g.id);
    await loginAs(admin);
    expectOk(await usersActions.unlinkGoogle(g.id));
    await cannotFinish(g.id, cg);
  });

  test("los de otras personas no se tocan", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const other = await makeUser({ role: "ADMIN" });
    await twoPending(other.id);
    await loginAs(admin);
    expectOk(await forcePasswordChange(target.id, { copyLink: true }));
    assert.equal(await halfDone(other.id), 2);
    logout();
  });
});

describe("forzar el cambio de contraseña desconecta lo que funciona sin sesión", () => {
  const realFetch = globalThis.fetch;

  /** Calendario suscrito, Telegram (con un enlace de conexión a medio usar), WhatsApp y Google Drive. */
  async function connectEverything(userId: string) {
    await db.calendarFeed.create({ data: { userId, tokenHash: hashFeedToken(newFeedToken()) } });
    await db.userChannel.create({ data: { userId, channel: "TELEGRAM", address: `77${userId.slice(-6)}` } });
    await db.userChannel.create({ data: { userId, channel: "WHATSAPP", address: "+34600111222", consentAt: new Date(), verifiedAt: new Date() } });
    await db.telegramLinkCode.create({ data: { hash: `link-${userId}`, userId, expiresAt: new Date(Date.now() + 600_000) } });
    await db.googleAccount.create({ data: { userId, email: "drive@example.com", refreshTokenEnc: encryptSecret("refresh-de-prueba"), scope: "drive.file" } });
  }
  const connected = async (userId: string) => ({
    feeds: await db.calendarFeed.count({ where: { userId } }),
    channels: await db.userChannel.count({ where: { userId } }),
    linkCodes: await db.telegramLinkCode.count({ where: { userId } }),
    google: await db.googleAccount.count({ where: { userId } }),
  });
  const ALL = { feeds: 1, channels: 2, linkCodes: 1, google: 1 };

  test("lo hace un administrador: borra el calendario suscrito, Telegram, WhatsApp y la conexión con Drive (retirando el permiso en Google)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const bystander = await makeUser();
    await connectEverything(target.id);
    await connectEverything(bystander.id);
    const revoked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/revoke")) {
        revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
        return new Response("{}", { status: 200 });
      }
      throw new Error(`fetch inesperado: ${String(input)}`);
    }) as typeof fetch;
    try {
      await loginAs(admin);
      expectOk(await forcePasswordChange(target.id, { copyLink: true }));
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(await connected(target.id), { feeds: 0, channels: 0, linkCodes: 0, google: 0 });
    assert.deepEqual(revoked, ["refresh-de-prueba"]);
    // Lo de otras personas no se toca.
    assert.deepEqual(await connected(bystander.id), ALL);
  });

  test("cambiar uno mismo la contraseña (Mi perfil o al elegir una nueva) o restablecerla con el enlace no desconecta nada", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      throw new Error(`fetch inesperado: ${String(input)}`);
    }) as typeof fetch;
    try {
      const self = await makeUser();
      await db.user.update({ where: { id: self.id }, data: { passwordHash: await hashPassword("clave-original-123") } });
      await connectEverything(self.id);
      await loginAs(self);
      expectOk(await changePassword("clave-original-123", "clave-nueva-desde-perfil-1"));
      assert.deepEqual(await connected(self.id), ALL);

      const pending = await makeUser({ mustChangePassword: true });
      await connectEverything(pending.id);
      await loginAs(pending);
      expectOk(await setNewPassword("clave-elegida-al-entrar-1"));
      assert.deepEqual(await connected(pending.id), ALL);

      const reset = await makeUser();
      await connectEverything(reset.id);
      const token = await issueAuthToken(reset.id, "PASSWORD_RESET");
      logout();
      expectOk(await resetPassword(token, "clave-restablecida-segura-3"));
      assert.deepEqual(await connected(reset.id), ALL);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("límite de intentos de acceso por cuenta y dispositivos conocidos", () => {
  const PASSWORD = "clave-de-acceso-1234";
  const TOO_MANY = "Demasiados intentos. Espera unos minutos.";
  const WRONG = "Credenciales incorrectas.";

  async function attempt(email: string, password: string): Promise<{ error?: string; redirect?: string }> {
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    try {
      return await login({}, form);
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? "";
      if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] };
      throw err;
    }
  }

  /** Cuenta sin verificación en dos pasos que ya ha entrado una vez desde «su» navegador (sin «Recordar»): sus cookies. */
  async function accountWithDevice() {
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    logout();
    assert.deepEqual(await attempt(user.email, PASSWORD), { redirect: "/" });
    const device = await db.knownDevice.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(device.trustedUntil, null, "sin «Recordar»: dispositivo conocido, no de confianza");
    return { user, browser: saveSession() };
  }

  test("un tercero que gasta los intentos de la cuenta desde otro navegador no impide entrar desde un dispositivo conocido", async () => {
    const { user, browser } = await accountWithDevice();
    logout();
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) assert.equal((await attempt(user.email, `otra-clave-${i}-9999`)).error, WRONG, `intento ${i + 1}`);
    // Desde un navegador sin la cookie, bloqueada (aun con la contraseña correcta).
    assert.equal((await attempt(user.email, PASSWORD)).error, TOO_MANY);
    // Desde el suyo, entra.
    restoreSession(browser);
    assert.deepEqual(await attempt(user.email, PASSWORD), { redirect: "/" });
  });

  test("desde el dispositivo conocido el tope es LOGIN_ACCOUNT_LIMIT_TRUSTED; el de otra cuenta no da intentos extra", async () => {
    const { user, browser } = await accountWithDevice();
    const other = await accountWithDevice();
    // El navegador de otra cuenta es desconocido para esta: se queda en LOGIN_ACCOUNT_LIMIT.
    restoreSession(other.browser);
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) assert.equal((await attempt(user.email, `otra-clave-${i}-9999`)).error, WRONG);
    assert.equal((await attempt(user.email, "otra-clave-x-9999")).error, TOO_MANY);
    // El suyo llega hasta LOGIN_ACCOUNT_LIMIT_TRUSTED y después también queda bloqueado.
    restoreSession(browser);
    for (let i = LOGIN_ACCOUNT_LIMIT; i < LOGIN_ACCOUNT_LIMIT_TRUSTED; i++) assert.equal((await attempt(user.email, `otra-clave-${i}-9999`)).error, WRONG, `intento ${i + 1}`);
    assert.equal((await attempt(user.email, PASSWORD)).error, TOO_MANY);
  });
});

describe("editar un usuario: dos administradores a la vez (Administración → Usuarios)", () => {
  const STALE = /Los datos han cambiado mientras tanto: recarga la página/;
  const seen = (u: { name: string; email: string; role: "ADMIN" | "MEMBER"; active: boolean }) => ({ name: u.name, email: u.email, role: u.role, active: u.active });
  const row = (id: string) => db.user.findUniqueOrThrow({ where: { id }, select: { name: true, email: true, role: true, active: true } });

  test("con la lista desfasada solo se aplica lo que se ha cambiado: corregir el nombre no reactiva a quien otro ha desactivado", async () => {
    const [a, b, x] = [await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" }), await makeUser()];
    const openedByA = seen(x); // A tiene la pantalla abierta
    await loginAs(b);
    expectOk(await updateUser(x.id, { ...seen(x), active: false, expected: seen(x) }));
    await loginAs(a);
    expectOk(await updateUser(x.id, { ...openedByA, name: "Nombre corregido", expected: openedByA }));
    assert.deepEqual(await row(x.id), { ...openedByA, name: "Nombre corregido", active: false });
  });

  test("si otro ha cambiado el mismo campo, se rechaza sin pisarlo; sin los valores vistos, también", async () => {
    const [a, b, x] = [await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" }), await makeUser()];
    const openedByA = seen(x);
    await loginAs(b);
    expectOk(await updateUser(x.id, { ...seen(x), name: "Nombre de B", email: `b-${x.id}@example.com`, expected: seen(x) }));
    const afterB = await row(x.id);
    await loginAs(a);
    expectFail(await updateUser(x.id, { ...openedByA, name: "Nombre de A", expected: openedByA }), STALE);
    expectFail(await updateUser(x.id, { ...openedByA, email: `a-${x.id}@example.com`, expected: openedByA }), STALE);
    assert.deepEqual(await row(x.id), afterB);
    // Al mismo valor que ya dejó B no es un conflicto.
    expectOk(await updateUser(x.id, { ...openedByA, name: "Nombre de B", expected: openedByA }));
    // Una llamada sin los valores vistos (un navegador con la versión anterior) no se aplica.
    expectFail(await updateUser(x.id, { ...seen(afterB), name: "Sin valores vistos" }), STALE);
    assert.deepEqual(await row(x.id), afterB);
  });

  test("a la vez de verdad: el cambio de A espera al de B y compara con lo que B ha dejado", async () => {
    const [a, x] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const openedByA = seen(x);
    await loginAs(a);
    let rename: ReturnType<typeof updateUser> | null = null;
    let reEmail: ReturnType<typeof updateUser> | null = null;
    // «B» (la prueba) desactiva a X y le cambia el email con la fila bloqueada; A corrige el nombre y, por separado,
    // intenta cambiar el email. Las dos acciones esperan a la fila y, al seguir, leen lo que dejó B.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${x.id} FOR UPDATE`;
      await tx.user.update({ where: { id: x.id }, data: { active: false, email: `b-${x.id}@example.com` } });
      rename = updateUser(x.id, { ...openedByA, name: "Corregido a la vez", expected: openedByA });
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectOk(await rename!);
    assert.deepEqual(await row(x.id), { ...openedByA, name: "Corregido a la vez", email: `b-${x.id}@example.com`, active: false });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${x.id} FOR UPDATE`;
      await tx.user.update({ where: { id: x.id }, data: { email: `b2-${x.id}@example.com` } });
      // A había abierto la pantalla tras el primer cambio de B (con el email `b-…`).
      const seenByA = { ...openedByA, name: "Corregido a la vez", email: `b-${x.id}@example.com`, active: false };
      reEmail = updateUser(x.id, { ...seenByA, email: `a-${x.id}@example.com`, expected: seenByA });
      await waitForLockWaiter();
    }, { timeout: 10_000 });
    expectFail(await reEmail!, STALE);
    assert.equal((await row(x.id)).email, `b2-${x.id}@example.com`);
  });

  test("las asignaciones del cambio de rol se leen dentro de la transacción: cuenta el proyecto añadido mientras tanto", async () => {
    const [a, x] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const before = await makeProject({ members: [x] });
    const meanwhile = await makeProject({ members: [] });
    await loginAs(a);
    let promote: ReturnType<typeof updateUser> | null = null;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${x.id} FOR UPDATE`;
      promote = updateUser(x.id, { ...seen(x), role: "ADMIN", expected: seen(x) });
      await waitForLockWaiter();
      // Otro administrador la añade a un proyecto de equipo mientras la acción espera.
      await tx.projectMember.create({ data: { projectId: meanwhile.project.id, userId: x.id } });
    }, { timeout: 10_000 });
    expectOk(await promote!);
    const picks = await db.adminProjectPick.findMany({ where: { userId: x.id }, select: { projectId: true } });
    assert.deepEqual(picks.map((p) => p.projectId).sort(), [before.project.id, meanwhile.project.id].sort(), "los dos quedan elegidos");
  });
});

/** Ejecuta `fn` con el buzón de pruebas en una carpeta nueva y devuelve cuántos emails se han escrito en ella. */
async function countMails(fn: () => Promise<void>): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-mails-"));
  const prev = process.env.MAIL_OUTBOX_DIR;
  process.env.MAIL_OUTBOX_DIR = dir;
  try {
    await fn();
    await afterDone();
    return (await readdir(dir)).length;
  } finally {
    process.env.MAIL_OUTBOX_DIR = prev ?? "";
    await rm(dir, { recursive: true, force: true });
  }
}

describe("topes de los emails de «¿Olvidaste tu contraseña?»", () => {
  // La IP de las pruebas (sin cabeceras): sus topes de 15 min se vacían entre peticiones, como si pasara el tiempo.
  const freshWindow = (email: string) => {
    resetRateLimit(`reset:email:${email}`);
    for (const ip of ["unknown", "127.0.0.1", "::1"]) resetRateLimit(`reset:ip:${ip}`);
  };

  test("5 al día a una dirección: la 6.ª petición responde igual y no envía nada", async () => {
    resetRateLimit("reset:all");
    const user = await makeUser();
    const email = (await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } })).email;
    resetRateLimit(`reset:email-day:${email}`);
    const sent = await countMails(async () => {
      for (let i = 0; i < 6; i++) {
        freshWindow(email);
        expectOk(await requestPasswordReset(email));
        await afterDone();
      }
    });
    assert.equal(sent, 5);
    // Una dirección sin cuenta no gasta el tope de nadie (ni el global): tampoco se envía nada.
    resetRateLimit("reset:all");
    assert.equal(await countMails(async () => expectOk(await requestPasswordReset("nadie-reset@example.com"))), 0);
    assert.equal(rateLimitReached("reset:all", 1), false);
    resetRateLimit(`reset:email-day:${email}`);
  });

  test("30 por hora en total: después, no sale ninguno, la respuesta es la misma y queda una línea en Logs (una por hora)", async () => {
    resetRateLimit("reset:all");
    resetRateLimit("reset:all:logged");
    rateLimit("reset:all", 30, 60 * 60_000, 30); // ya se han enviado 30 esta hora
    const a = await makeUser();
    const b = await makeUser();
    const emails = await Promise.all([a, b].map(async (u) => (await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } })).email));
    const since = new Date();
    const sent = await countMails(async () => {
      for (const email of emails) {
        freshWindow(email);
        expectOk(await requestPasswordReset(email));
        await afterDone();
      }
    });
    assert.equal(sent, 0);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "auth.resetMailCapped", createdAt: { gte: since } } }), 1);
    // El tope por dirección no se ha gastado.
    for (const email of emails) assert.equal(rateLimitReached(`reset:email-day:${email}`, 1), false, email);
    resetRateLimit("reset:all");
    resetRateLimit("reset:all:logged");
  });
});

describe("códigos de la verificación en dos pasos por email: tope por persona", () => {
  test("10 por hora entre todos sus desafíos: el 11.º (en un desafío nuevo) no se envía", async () => {
    const user = await makeUser();
    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true } });
    const challenge = () => db.loginChallenge.create({ data: { userId: user.id, kind: "LOGIN", tokenHash: hashAuthToken(newToken()), expiresAt: new Date(Date.now() + 600_000) }, select: { id: true, userId: true } });
    let refused: unknown = null;
    const sent = await countMails(async () => {
      for (let i = 0; i < 10; i++) await sendEmailCode(await challenge(), me);
      await sendEmailCode(await challenge(), me).catch((err: unknown) => { refused = err; });
    });
    assert.equal(sent, 10);
    assert.match(String((refused as Error | null)?.message), /Demasiados envíos/);
    // Otra persona no se ve afectada.
    const other = await makeUser();
    const them = await db.user.findUniqueOrThrow({ where: { id: other.id }, select: { name: true, email: true, locale: true } });
    const theirs = await db.loginChallenge.create({ data: { userId: other.id, kind: "LOGIN", tokenHash: hashAuthToken(newToken()), expiresAt: new Date(Date.now() + 600_000) }, select: { id: true, userId: true } });
    assert.equal(await countMails(() => sendEmailCode(theirs, them)), 1);
  });
});
