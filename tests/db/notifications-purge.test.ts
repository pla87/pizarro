// Mantenimiento de avisos contra PostgreSQL real: leídos de más de 90 días y sin leer de más de un año.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, makeUser } from "./helpers";
import { MAINTENANCE_JOBS } from "../../src/lib/maintenance";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe("mantenimiento de avisos", () => {
  test("borra los leídos de más de 90 días y los no leídos de más de un año; conserva el resto", async () => {
    const u = await makeUser();
    const mk = (createdDays: number, read: boolean) =>
      db.notification.create({ data: { userId: u.id, type: "MENTION", excerpt: `n-${createdDays}-${read}`, createdAt: ago(createdDays), readAt: read ? ago(createdDays - 1) : null } });
    const readOld = await mk(100, true);
    const readRecent = await mk(30, true);
    const unreadAncient = await mk(400, false);
    const unreadJustOver = await mk(366, false);
    const unreadHalfYear = await mk(200, false);
    const unreadJustUnder = await mk(360, false);
    const readAncient = await mk(500, true);

    const job = MAINTENANCE_JOBS.find((j) => j.name === "notifications")!;
    const deleted = (await job.run()) as number;
    assert.ok(deleted >= 4, `borra al menos las cuatro viejas (borró ${deleted})`);

    const left = new Set((await db.notification.findMany({ where: { userId: u.id }, select: { id: true } })).map((n) => n.id));
    for (const gone of [readOld, unreadAncient, unreadJustOver, readAncient]) assert.equal(left.has(gone.id), false, gone.excerpt);
    for (const kept of [readRecent, unreadHalfYear, unreadJustUnder]) assert.equal(left.has(kept.id), true, kept.excerpt);
  });

  test("una segunda pasada no borra nada más", async () => {
    const u = await makeUser();
    await db.notification.create({ data: { userId: u.id, type: "MENTION", excerpt: "reciente", createdAt: ago(2) } });
    const job = MAINTENANCE_JOBS.find((j) => j.name === "notifications")!;
    await job.run();
    assert.equal(await db.notification.count({ where: { userId: u.id } }), 1);
  });
});
