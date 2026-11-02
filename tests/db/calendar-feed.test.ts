// Suscripción al calendario (.ics vivo) contra PostgreSQL real: token, permisos, regeneración y límite de ritmo.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createCalendarFeed, disableCalendarFeed, setCalendarFeedScope } from "../../src/actions/calendar-feed";
import { GET } from "../../src/app/api/calendar/[file]/route";

let n = 0;
/** Pide la suscripción como lo haría un cliente de calendario (sin sesión), desde una IP propia de cada llamada. */
async function fetchFeed(token: string, ip = `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`, headers: Record<string, string> = {}) {
  const res = await GET(new Request(`https://app.example.com/api/calendar/${token}.ics`, { headers: { "x-real-ip": ip, ...headers } }), { params: Promise.resolve({ file: `${token}.ics` }) });
  return { res, text: await res.text() };
}

const tokenOf = (https: string) => /\/api\/calendar\/([^/]+)\.ics$/.exec(https)![1]!;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

async function feedFor(user: { id: string }, scope: "MINE" | "ALL" = "ALL") {
  await loginAs(user);
  const links = expectOk(await createCalendarFeed(scope));
  return { ...links, token: tokenOf(links.https) };
}

describe("calendario suscrito", () => {
  test("token válido: .ics con tareas y entregables; en la BD solo el hash", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f, { title: "Preparar, informe; final", dueDate: inDays(5) });
    await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega A", position: 1, dueDate: inDays(10) } });
    const { token, https, webcal, google } = await feedFor(user);
    assert.ok(Buffer.from(token, "base64url").length >= 32);
    assert.match(https, /^https?:\/\/.+\/api\/calendar\/.+\.ics$/);
    assert.ok(webcal.startsWith("webcal://"));
    assert.ok(google.startsWith("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F"));
    const row = await db.calendarFeed.findUniqueOrThrow({ where: { userId: user.id } });
    assert.notEqual(row.tokenHash, token);
    assert.ok(!JSON.stringify(row).includes(token));

    const { res, text } = await fetchFeed(token);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
    assert.match(res.headers.get("cache-control") ?? "", /^private, max-age=\d+$/);
    assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(text.includes(`UID:${task.id}@pizarro`));
    assert.ok(text.includes(`SUMMARY:[${f.project.name}] Preparar\\, informe\\; final`));
    assert.ok(text.includes("SUMMARY:[" + f.project.name + "] Entregable: Entrega A"));
    assert.ok(text.replace(/\r\n /g, "").includes(`/p/${f.project.id}?task=${task.id}`));
    assert.match(text, /SEQUENCE:\d+/);
    for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
    // Mismo contenido, mismo ETag: 304.
    const etag = res.headers.get("etag")!;
    const again = await fetchFeed(token, undefined, { "if-none-match": etag });
    assert.equal(again.res.status, 304);
  });

  test("regenerar invalida el enlace anterior; desactivar deja de servir; reactivar da uno nuevo", async () => {
    const user = await makeUser();
    const a = await feedFor(user);
    assert.equal((await fetchFeed(a.token)).res.status, 200);
    const b = await feedFor(user);
    assert.notEqual(a.token, b.token);
    assert.equal((await fetchFeed(a.token)).res.status, 404);
    assert.equal((await fetchFeed(b.token)).res.status, 200);
    expectOk(await disableCalendarFeed());
    assert.equal((await fetchFeed(b.token)).res.status, 404);
    assert.equal(await db.calendarFeed.count({ where: { userId: user.id } }), 0);
    const c = await feedFor(user);
    assert.equal((await fetchFeed(c.token)).res.status, 200);
    assert.equal((await fetchFeed(b.token)).res.status, 404);
  });

  test("todos los fallos dan el mismo 404 genérico", async () => {
    const user = await makeUser();
    const live = await feedFor(user);
    expectOk(await disableCalendarFeed());
    const cases = [live.token, "x".repeat(43), "corto", "a".repeat(200)];
    const seen = [];
    for (const tok of cases) {
      const { res, text } = await fetchFeed(tok);
      seen.push([res.status, text, res.headers.get("content-type")]);
    }
    for (const s of seen) assert.deepEqual(s, [404, "Not found", "text/plain; charset=utf-8"]);
    // Sin extensión .ics tampoco.
    const res = await GET(new Request("https://app.example.com/api/calendar/abc", { headers: { "x-real-ip": "10.8.8.8" } }), { params: Promise.resolve({ file: "abc" }) });
    assert.equal(res.status, 404);
  });

  test("usuario desactivado o borrado: el token deja de valer", async () => {
    const inactive = await makeUser();
    const a = await feedFor(inactive);
    assert.equal((await fetchFeed(a.token)).res.status, 200);
    await db.user.update({ where: { id: inactive.id }, data: { active: false } });
    assert.equal((await fetchFeed(a.token)).res.status, 404);
    await db.user.update({ where: { id: inactive.id }, data: { active: true } });
    assert.equal((await fetchFeed(a.token)).res.status, 200);

    const gone = await makeUser();
    const b = await feedFor(gone);
    assert.equal((await fetchFeed(b.token)).res.status, 200);
    await db.user.delete({ where: { id: gone.id } });
    assert.equal((await fetchFeed(b.token)).res.status, 404);
    assert.equal(await db.calendarFeed.count({ where: { tokenHash: (await import("../../src/lib/calendar-feed-core")).hashFeedToken(b.token) } }), 0);
  });

  test("permisos: no se filtran tareas de proyectos sin acceso y se reevalúan en cada petición", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const mine = await makeProject({ members: [user] });
    const foreign = await makeProject({ members: [other] });
    const privateOther = await makeProject({ visibility: "PRIVATE", owner: other });
    const ok = await makeTask(mine, { title: "Visible", dueDate: inDays(3) });
    const hidden = await makeTask(foreign, { title: "Ajena", dueDate: inDays(3) });
    const hiddenPrivate = await makeTask(privateOther, { title: "Privada ajena", dueDate: inDays(3) });
    await db.deliverable.create({ data: { projectId: foreign.project.id, name: "Entrega ajena", position: 1, dueDate: inDays(4) } });
    const { token } = await feedFor(user, "ALL");
    let { text } = await fetchFeed(token);
    assert.ok(text.includes(`${ok.id}@pizarro`));
    for (const t of [hidden, hiddenPrivate]) assert.ok(!text.includes(t.id));
    assert.ok(!text.includes("Entrega ajena") && !text.includes(foreign.project.name) && !text.includes(privateOther.project.name));

    // Se le quita el acceso a su proyecto: desaparece sin regenerar el enlace.
    await db.projectMember.deleteMany({ where: { projectId: mine.project.id, userId: user.id } });
    ({ text } = await fetchFeed(token));
    assert.ok(!text.includes(ok.id));
    assert.ok(!text.includes("VEVENT"));
    // Y si se le da acceso al ajeno, aparece.
    await db.projectMember.create({ data: { projectId: foreign.project.id, userId: user.id } });
    ({ text } = await fetchFeed(token));
    assert.ok(text.includes(hidden.id));
  });

  test("un administrador ve los proyectos de equipo pero no los privados ajenos", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const owner = await makeUser();
    const team = await makeProject({ members: [owner] });
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const t1 = await makeTask(team, { dueDate: inDays(2) });
    const t2 = await makeTask(priv, { dueDate: inDays(2) });
    const { token } = await feedFor(admin, "ALL");
    const { text } = await fetchFeed(token);
    assert.ok(text.includes(t1.id));
    assert.ok(!text.includes(t2.id));
  });

  test("ámbito: solo las asignadas a mí o todas las de mis proyectos", async () => {
    const user = await makeUser();
    const mate = await makeUser();
    const f = await makeProject({ members: [user, mate] });
    const mineTask = await makeTask(f, { dueDate: inDays(2) });
    const mateTask = await makeTask(f, { dueDate: inDays(2) });
    await db.task.update({ where: { id: mineTask.id }, data: { assigneeId: user.id } });
    await db.task.update({ where: { id: mateTask.id }, data: { assigneeId: mate.id } });
    const del = await db.deliverable.create({ data: { projectId: f.project.id, name: "Sin tareas mías", position: 1, dueDate: inDays(4) } });
    const { token } = await feedFor(user, "MINE");
    let { text } = await fetchFeed(token);
    assert.ok(text.includes(mineTask.id));
    assert.ok(!text.includes(mateTask.id));
    assert.ok(!text.includes(del.id));
    expectOk(await setCalendarFeedScope("ALL"));
    ({ text } = await fetchFeed(token));
    assert.ok(text.includes(mineTask.id) && text.includes(mateTask.id) && text.includes(del.id));
  });

  test("excluye archivadas, sin fecha y fuera de la ventana; el rango usa la fecha de inicio solo si el proyecto la activa", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const inside = await makeTask(f, { dueDate: inDays(7) });
    const archived = await makeTask(f, { dueDate: inDays(7) });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const noDate = await makeTask(f);
    const tooOld = await makeTask(f, { dueDate: inDays(-90) });
    const tooFar = await makeTask(f, { dueDate: inDays(400) });
    const recent = await makeTask(f, { dueDate: inDays(-30) });
    const start = new Date(Date.now() + 3 * 86_400_000);
    await db.task.update({ where: { id: inside.id }, data: { startDate: start } });
    const { token } = await feedFor(user);
    let { text } = await fetchFeed(token);
    assert.ok(text.includes(inside.id) && text.includes(recent.id));
    for (const t of [archived, noDate, tooOld, tooFar]) assert.ok(!text.includes(t.id));
    const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const block = (id: string) => text.split("BEGIN:VEVENT").find((b) => b.includes(id))!;
    assert.ok(block(inside.id).includes(`DTSTART;VALUE=DATE:${day(inDays(7))}`), "sin el campo activo, un solo día");
    await db.project.update({ where: { id: f.project.id }, data: { taskFields: ["startDate"] } });
    ({ text } = await fetchFeed(token, undefined, {}));
    assert.ok(block(inside.id).includes(`DTSTART;VALUE=DATE:${day(start)}`), "con el campo activo, de inicio a límite");
  });

  test("límite de ritmo por token e IP", async () => {
    const user = await makeUser();
    const { token } = await feedFor(user);
    const ip = "10.7.7.7";
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await fetchFeed(token, ip)).res.status;
    assert.equal(last, 429);
    // Otro token desde otra IP no se ve afectado.
    const other = await feedFor(await makeUser());
    assert.equal((await fetchFeed(other.token, "10.7.7.8")).res.status, 200);
    // La misma IP probando muchos tokens falsos acaba limitada.
    let blocked = false;
    for (let i = 0; i < 320 && !blocked; i++) blocked = (await fetchFeed(`${i}`.padStart(43, "z"), "10.7.7.9")).res.status === 429;
    assert.ok(blocked);
  });

  test("crear sin sesión falla", async () => {
    const { logout } = await import("./helpers");
    logout();
    const res = await createCalendarFeed("MINE");
    assert.equal(res.ok, false);
  });
});
