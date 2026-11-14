// Aviso a los administradores cuando un proyecto privado pasa a ser de equipo al borrarse la cuenta de su único
// miembro (eraseUser → notifyProjectsToTeam), contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { afterDone, db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { deleteMyAccount } from "../../src/actions/profile";
import { deleteUser } from "../../src/actions/users";
import { hashPassword } from "../../src/lib/password";
import { visibleNotificationsWhere } from "../../src/lib/notification-access";
import { notificationBody, notificationHeadline } from "../../src/lib/notification-text";
import { makeT } from "../../src/i18n/core";
import type { CurrentUser } from "../../src/lib/session";

const PASSWORD = "una-clave-larga-1";
const hash = await hashPassword(PASSWORD);
const asUser = (u: { id: string; role: "ADMIN" | "MEMBER" }) => ({ id: u.id, role: u.role }) as CurrentUser;
const notices = (projectId: string) => db.notification.findMany({ where: { projectId, type: "PROJECT_TO_TEAM" }, select: { userId: true, taskId: true, excerpt: true, emailSentAt: true } });

/** Emails de la carpeta de salida dirigidos a `to`. */
async function mailsTo(dir: string, to: string): Promise<{ subject: string; text: string }[]> {
  const out = [];
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".json"))) {
    const m = JSON.parse(await readFile(join(dir, f), "utf8")) as { to: string; subject: string; text: string };
    if (m.to === to) out.push(m);
  }
  return out;
}

describe("aviso a los administradores: un proyecto privado pasa a ser de equipo al borrarse una cuenta", () => {
  test("uno por proyecto y administrador activo, con enlace al proyecto; en la campana y por email en su idioma", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pz-aviso-equipo-"));
    const prev = process.env.MAIL_OUTBOX_DIR;
    process.env.MAIL_OUTBOX_DIR = dir;
    try {
      const es = await makeUser({ role: "ADMIN" });
      const en = await makeUser({ role: "ADMIN" });
      const noMail = await makeUser({ role: "ADMIN" });
      const off = await makeUser({ role: "ADMIN", active: false });
      const plain = await makeUser();
      await db.user.update({ where: { id: en.id }, data: { locale: "EN" } });
      await db.user.update({ where: { id: noMail.id }, data: { notifyEmail: false } });
      const u = await makeUser({ name: "Lucía Baja" });
      await db.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
      const a = await makeProject({ visibility: "PRIVATE", owner: u });
      const b = await makeProject({ visibility: "PRIVATE", owner: u });
      const dropped = await makeProject({ visibility: "PRIVATE", owner: u });
      await loginAs(u);
      expectOk(await deleteMyAccount({ password: PASSWORD, deleteProjects: [dropped.project.id] }));
      await afterDone();

      for (const p of [a, b]) {
        const rows = await notices(p.project.id);
        const to = new Set(rows.map((r) => r.userId));
        for (const admin of [es, en, noMail]) assert.ok(to.has(admin.id), "cada administrador activo, uno por proyecto");
        assert.equal(rows.filter((r) => r.userId === es.id).length, 1);
        assert.ok(!to.has(off.id), "no a un administrador desactivado");
        assert.ok(!to.has(plain.id), "no a quien no es administrador");
        assert.ok(rows.every((r) => r.taskId === null && r.excerpt === "Lucía Baja"), "de proyecto, con el nombre de la cuenta borrada");
      }
      // El borrado con la casilla no avisa (ya no existe).
      assert.equal(await db.notification.count({ where: { type: "PROJECT_TO_TEAM", excerpt: "Lucía Baja", projectId: null } }), 0);

      // En la campana de cada uno (contador incluido), y el texto en su idioma al leerlo.
      const mine = await db.notification.findMany({ where: { ...visibleNotificationsWhere(asUser(es)), type: "PROJECT_TO_TEAM", excerpt: "Lucía Baja" }, select: { projectId: true } });
      assert.deepEqual(new Set(mine.map((n) => n.projectId)), new Set([a.project.id, b.project.id]));
      const vars = { actor: "Lucía Baja", task: makeT("es")("«{title}»", { title: a.project.name }) };
      assert.equal(notificationHeadline("PROJECT_TO_TEAM", makeT("es"), vars), `El proyecto «${a.project.name}» de Lucía Baja ha pasado a ser de equipo al borrarse su cuenta`);
      assert.match(notificationHeadline("PROJECT_TO_TEAM", makeT("en"), { actor: "Lucía Baja", task: makeT("en")("«{title}»", { title: a.project.name }) }), /^Lucía Baja's account was deleted: the project “.+” is now a team project$/);
      assert.match(notificationBody("PROJECT_TO_TEAM", "Lucía Baja", makeT("es"), "es-ES"), /Ahora lo ven los administradores/);

      // Por email según «Avisos de menciones» y en el idioma de cada uno; quien lo tiene desactivado, solo en la campana.
      const esMails = await mailsTo(dir, es.email);
      assert.equal(esMails.length, 2, "un email por proyecto");
      assert.ok(esMails.some((m) => m.subject === `El proyecto «${a.project.name}» de Lucía Baja ha pasado a ser de equipo al borrarse su cuenta`));
      assert.ok(esMails.every((m) => /Abrir el proyecto: http.+\/p\/[^?\s]+\n/.test(m.text)), "con enlace al proyecto");
      assert.ok(esMails.some((m) => m.text.includes(`/p/${a.project.id}\n`)));
      const enMails = await mailsTo(dir, en.email);
      assert.equal(enMails.length, 2);
      assert.ok(enMails.every((m) => /account was deleted/.test(m.subject) && /Open the project/.test(m.text)));
      assert.equal((await mailsTo(dir, noMail.email)).length, 0);
      assert.equal((await notices(a.project.id)).find((r) => r.userId === noMail.id)?.emailSentAt, null);
    } finally {
      process.env.MAIL_OUTBOX_DIR = prev ?? "";
      if (prev === undefined) delete process.env.MAIL_OUTBOX_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("desde Administración → Usuarios: no se avisa a quien la borra (acaba de ver la lista); la casilla, sin aviso", async () => {
    const actor = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const keep = await makeProject({ visibility: "PRIVATE", owner: u });
    const drop = await makeProject({ visibility: "PRIVATE", owner: u });
    await loginAs(actor);
    expectOk(await deleteUser(u.id, [drop.project.id]));
    await afterDone();
    const rows = await notices(keep.project.id);
    assert.ok(rows.some((r) => r.userId === other.id));
    assert.ok(!rows.some((r) => r.userId === actor.id));
    assert.equal(await db.notification.count({ where: { projectId: drop.project.id } }), 0);
  });

  test("solo lo ve quien puede ver el proyecto; borrar el proyecto borra el aviso", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner: u });
    await loginAs(admin);
    expectOk(await deleteUser(u.id));
    await afterDone();
    const visible = () => db.notification.count({ where: { ...visibleNotificationsWhere(asUser(admin)), projectId: p.project.id } });
    assert.equal(await visible(), 0, "quien lo borra no recibe aviso");
    const other = await makeUser({ role: "ADMIN" });
    const seen = () => db.notification.count({ where: { ...visibleNotificationsWhere(asUser(other)), projectId: p.project.id } });
    assert.equal(await seen(), 0, "un administrador nuevo no tiene avisos de antes");
    const [n] = await db.notification.findMany({ where: { projectId: p.project.id }, take: 1, select: { userId: true } });
    const someone = await db.user.findUniqueOrThrow({ where: { id: n!.userId }, select: { id: true, role: true } });
    const count = () => db.notification.count({ where: { ...visibleNotificationsWhere(asUser(someone)), projectId: p.project.id } });
    assert.equal(await count(), 1);
    // Si vuelve a ser privado (de otra persona), deja de verse en la campana.
    await db.project.update({ where: { id: p.project.id }, data: { isPrivate: true } });
    assert.equal(await count(), 0);
    await db.project.delete({ where: { id: p.project.id } });
    assert.equal(await db.notification.count({ where: { projectId: p.project.id } }), 0);
  });
});
