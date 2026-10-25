// Re-enlazado de Google tras desvincular, aviso de copia atrasada y paso de equipo a privado, contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { allowGoogleRelink, unlinkGoogle } from "../../src/actions/users";
import { setProjectVisibility } from "../../src/actions/projects";
import { findUserForGoogle } from "../../src/lib/google-login";
import { completeLogin } from "../../src/lib/login";
import { notifyBackupAlertIfDue } from "../../src/lib/backup-alert";

const identityFor = (u: { email: string }, sub: string) => ({ sub, email: u.email, name: null });

describe("Google: no re-enlazar tras desvincular", () => {
  test("unlinkGoogle marca el bloqueo; Google por email no enlaza; «Permitir Google» lo levanta", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    await db.user.update({ where: { id: target.id }, data: { googleSub: `sub-${target.id}` } });
    await loginAs(admin);
    expectOk(await unlinkGoogle(target.id));
    const row = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.googleSub, null);
    assert.equal(row.googleRelinkBlocked, true);

    // Entrar con Google por email: rechazado y sin enlace.
    assert.equal(await findUserForGoogle(identityFor(target, "nuevo-sub")), "relink_blocked");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleSub, null);

    // Permitir Google: solo admins, y solo si hay bloqueo.
    await loginAs(target);
    expectFail(await allowGoogleRelink(target.id), FORBIDDEN);
    await loginAs(admin);
    expectOk(await allowGoogleRelink(target.id));
    expectFail(await allowGoogleRelink(target.id), /no tiene Google bloqueado/);
    const found = await findUserForGoogle(identityFor(target, "nuevo-sub"));
    assert.ok(found && found !== "relink_blocked" && found.id === target.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleSub, "nuevo-sub");
  });

  test("entrar con la contraseña levanta el bloqueo; entrar con Google no", async () => {
    const target = await makeUser();
    await db.user.update({ where: { id: target.id }, data: { googleRelinkBlocked: true } });
    logout();
    const user = { id: target.id, name: target.name, email: target.email, locale: target.locale, mustChangePassword: false };
    await completeLogin(user, { method: "google", path: "/x" });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleRelinkBlocked, true);
    await completeLogin(user, { method: "password+2fa", path: "/x" });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleRelinkBlocked, false);
    const found = await findUserForGoogle(identityFor(target, `sub-${target.id}`));
    assert.ok(found && found !== "relink_blocked");
  });
});

describe("aviso de copia de seguridad atrasada por email", () => {
  test("avisa a los admins activos como mucho cada 24 h (persistido en AppState)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pz-alert-"));
    const saved = { ...process.env };
    process.env.UPLOAD_DIR = path.join(dir, "uploads");
    process.env.MAIL_OUTBOX_DIR = path.join(dir, "outbox");
    process.env.MAIL_OUTBOX_IN_PRODUCTION = "1";
    process.env.BACKUP_KEY = randomBytes(32).toString("base64");
    try {
      await db.appState.deleteMany({ where: { key: "backupAlertMailAt" } });
      await makeUser({ role: "ADMIN" });
      await makeUser({ role: "ADMIN", active: false });
      const active = await db.user.count({ where: { role: "ADMIN", active: true } });
      const now = Date.now();
      assert.equal(await notifyBackupAlertIfDue(now), active);
      // Casi enseguida y 23 h después: nada.
      assert.equal(await notifyBackupAlertIfDue(now + 1000), 0);
      assert.equal(await notifyBackupAlertIfDue(now + 23 * 3600_000), 0);
      // Pasadas 24 h vuelve a avisar.
      assert.equal(await notifyBackupAlertIfDue(now + 25 * 3600_000), active);
      // Sin BACKUP_KEY no hay aviso.
      delete process.env.BACKUP_KEY;
      assert.equal(await notifyBackupAlertIfDue(now + 100 * 3600_000), 0);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("equipo → privado conserva a los asignados", () => {
  test("los miembros se mantienen con sus tarjetas; el admin que solo lo veía por su elección lo pierde", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const pickAdmin = await makeUser({ role: "ADMIN" });
    const keep1 = await makeUser();
    const keep2 = await makeUser();
    const f = await makeProject({ members: [keep1, keep2] });
    await db.adminProjectPick.createMany({ data: [{ projectId: f.project.id, userId: admin.id }, { projectId: f.project.id, userId: pickAdmin.id }] });
    const kept = await makeTask(f);
    const lost = await makeTask(f);
    const mine = await makeTask(f);
    await db.task.update({ where: { id: kept.id }, data: { assigneeId: keep1.id } });
    await db.task.update({ where: { id: lost.id }, data: { assigneeId: pickAdmin.id } });
    await db.task.update({ where: { id: mine.id }, data: { assigneeId: admin.id } });

    await loginAs(admin);
    expectOk(await setProjectVisibility(f.project.id, "PRIVATE"));
    const members = (await db.projectMember.findMany({ where: { projectId: f.project.id } })).map((m) => m.userId).sort();
    assert.deepEqual(members, [admin.id, keep1.id, keep2.id].sort());
    assert.equal(await db.adminProjectPick.count({ where: { projectId: f.project.id } }), 0);
    const assignee = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).assigneeId;
    assert.equal(await assignee(kept.id), keep1.id);
    assert.equal(await assignee(mine.id), admin.id);
    assert.equal(await assignee(lost.id), null);
    const project = await db.project.findUniqueOrThrow({ where: { id: f.project.id } });
    assert.equal(project.isPrivate, true);
    assert.equal(project.privateOwnerId, admin.id);
    // pickAdmin ya no es miembro: no accede a un proyecto privado.
    assert.equal(await db.projectMember.count({ where: { projectId: f.project.id, userId: pickAdmin.id } }), 0);
  });
});
