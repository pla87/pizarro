// Suscripción al calendario (.ics vivo) contra PostgreSQL real: token, permisos, regeneración y límite de ritmo.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createCalendarFeed, disableCalendarFeed, setCalendarFeedScope } from "../../src/actions/calendar-feed";
import { GET } from "../../src/app/api/calendar/[file]/route";
import { onRequestError } from "../../src/instrumentation";
import { createProject } from "../../src/actions/projects";
import { defaultFeedScope } from "../../src/lib/calendar-feed";
import { buildColumnIcs } from "../../src/lib/column-views";
import { flushLogs } from "../../src/lib/log";

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
    // «Todas las de mis proyectos» sigue la página del calendario: un administrador ve los de equipo que ha elegido en su perfil.
    await db.adminProjectPick.create({ data: { projectId: team.project.id, userId: admin.id } });
    const { token } = await feedFor(admin, "ALL");
    const { text } = await fetchFeed(token);
    assert.ok(text.includes(t1.id));
    assert.ok(!text.includes(t2.id));
  });

  test("«todas»: un administrador solo ve los de equipo elegidos en su perfil y los privados de los que es miembro (como el calendario)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const owner = await makeUser();
    const picked = await makeProject({ members: [owner] });
    const unpicked = await makeProject({ members: [owner] });
    const privateMine = await makeProject({ visibility: "PRIVATE", owner: admin });
    const tPicked = await makeTask(picked, { dueDate: inDays(2) });
    const tUnpicked = await makeTask(unpicked, { dueDate: inDays(2) });
    const tPrivate = await makeTask(privateMine, { dueDate: inDays(2) });
    await db.task.update({ where: { id: tUnpicked.id }, data: { assigneeId: admin.id } });
    await db.deliverable.create({ data: { projectId: unpicked.project.id, name: "Entrega no elegida", position: 1, dueDate: inDays(3) } });
    await db.adminProjectPick.create({ data: { projectId: picked.project.id, userId: admin.id } });
    const { token } = await feedFor(admin, "ALL");
    let { text } = await fetchFeed(token);
    assert.ok(text.includes(tPicked.id) && text.includes(tPrivate.id));
    assert.ok(!text.includes(tUnpicked.id) && !text.includes("Entrega no elegida"));
    // «Solo las mías»: la tarea que le asignaron sigue saliendo aunque su proyecto no esté entre los elegidos.
    expectOk(await setCalendarFeedScope("MINE"));
    ({ text } = await fetchFeed(token));
    assert.ok(text.includes(tUnpicked.id));
    assert.ok(!text.includes(tPicked.id));
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

  test("ámbito por defecto: «Todas» si las tareas de sus proyectos no suelen tener responsable (ejemplo «Familia y casa»)", async () => {
    // Uso familiar: proyecto privado desde el ejemplo, cuyas tareas no tienen responsable. Antes salía marcado «Solo las
    // mías» y la suscripción quedaba vacía.
    const parent = await makeUser();
    await loginAs(parent);
    const home = expectOk(await createProject("Casa", { exampleKey: "familia-casa", isPrivate: true }));
    const dentist = await db.task.findFirstOrThrow({ where: { projectId: home.id, dueDate: { not: null } } });
    assert.equal(dentist.assigneeId, null);
    assert.equal(await defaultFeedScope(parent), "ALL");
    const { token } = await feedFor(parent, await defaultFeedScope(parent));
    assert.ok((await fetchFeed(token)).text.includes(dentist.id));
    // Equipo donde casi todo tiene responsable: «Solo las mías».
    const dev = await makeUser();
    const mate = await makeUser();
    const f = await makeProject({ members: [dev, mate] });
    for (const who of [dev, mate, mate]) await db.task.update({ where: { id: (await makeTask(f)).id }, data: { assigneeId: who.id } });
    await makeTask(f); // una sin responsable no cambia la mayoría
    assert.equal(await defaultFeedScope(dev), "MINE");
    // Mitad sin responsable (3 de 6): aún «Solo las mías»; más de la mitad, «Todas». Las archivadas no cuentan.
    await makeTask(f);
    await makeTask(f);
    assert.equal(await defaultFeedScope(dev), "MINE");
    await makeTask(f);
    assert.equal(await defaultFeedScope(dev), "ALL");
    await db.task.updateMany({ where: { projectId: f.project.id, assigneeId: null }, data: { archivedAt: new Date() } });
    assert.equal(await defaultFeedScope(dev), "MINE");
    // Sin ninguna tarea pendiente, «Todas».
    assert.equal(await defaultFeedScope(await makeUser()), "ALL");
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

  test("las tareas terminadas (columna que cuenta como hecha) no salen", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const doneCol = await db.column.create({ data: { projectId: f.project.id, name: "Hecho", position: 99_000, isDone: true } });
    const open = await makeTask(f, { dueDate: inDays(3) });
    const done = await makeTask(f, { columnId: doneCol.id, dueDate: inDays(3) });
    const { token } = await feedFor(user);
    const { text } = await fetchFeed(token);
    assert.ok(text.includes(`UID:${open.id}@pizarro`));
    assert.ok(!text.includes(`UID:${done.id}@pizarro`));
  });

  test("rotación de TOKEN_SECRET: el enlace guardado con la clave anterior se rehace con la actual y sigue valiendo al retirarla", async () => {
    const { createHmac } = await import("node:crypto");
    const user = await makeUser();
    const { token } = await feedFor(user);
    const old = "clave-anterior-de-prueba-".padEnd(48, "x");
    // Como si el enlace se hubiera creado antes de la rotación: su hash, con la clave anterior.
    await db.calendarFeed.update({ where: { userId: user.id }, data: { tokenHash: createHmac("sha256", old).update(`calendar-feed:${token}`).digest("hex") } });
    const prev = process.env.TOKEN_SECRET_PREVIOUS;
    process.env.TOKEN_SECRET_PREVIOUS = old;
    try {
      assert.equal((await fetchFeed(token)).res.status, 200);
    } finally {
      if (prev === undefined) delete process.env.TOKEN_SECRET_PREVIOUS;
      else process.env.TOKEN_SECRET_PREVIOUS = prev;
    }
    // Retirada la clave anterior, el enlace sigue funcionando.
    assert.equal((await fetchFeed(token)).res.status, 200);
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

  test("entregables: LAST-MODIFIED, DTSTAMP y SEQUENCE salen de su propio updatedAt (o del proyecto, si es más reciente)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const old = new Date("2026-01-10T08:00:00Z");
    const d = await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega con historia", position: 1, dueDate: inDays(6) } });
    // Valores antiguos fijos (también el del proyecto) para ver el efecto de cada cambio.
    await db.$executeRaw`UPDATE "Deliverable" SET "updatedAt" = ${old}, "createdAt" = ${old} WHERE id = ${d.id}`;
    await db.$executeRaw`UPDATE "Project" SET "updatedAt" = ${new Date("2026-01-05T08:00:00Z")} WHERE id = ${f.project.id}`;
    const { token } = await feedFor(user);
    const block = async () => (await fetchFeed(token)).text.split("BEGIN:VEVENT").find((b) => b.includes(`deliverable-${d.id}@pizarro`))!;
    let b = await block();
    assert.match(b, /LAST-MODIFIED:20260110T080000Z/);
    assert.match(b, /DTSTAMP:20260110T080000Z/);
    const seq1 = Number(/SEQUENCE:(\d+)/.exec(b)![1]);
    assert.equal(seq1, Math.floor(old.getTime() / 1000));
    // Editarlo sube la fecha y la secuencia (la creación no cambia).
    await db.deliverable.update({ where: { id: d.id }, data: { name: "Entrega renombrada" } });
    const row = await db.deliverable.findUniqueOrThrow({ where: { id: d.id } });
    assert.ok(row.updatedAt.getTime() > old.getTime() && row.createdAt.getTime() === old.getTime());
    b = await block();
    assert.ok(b.includes("Entrega renombrada"));
    assert.ok(Number(/SEQUENCE:(\d+)/.exec(b)![1]) > seq1);
    // Un cambio del proyecto más reciente que el del entregable manda.
    const later = new Date(row.updatedAt.getTime() + 86_400_000);
    await db.$executeRaw`UPDATE "Project" SET "updatedAt" = ${later} WHERE id = ${f.project.id}`;
    b = await block();
    assert.equal(Number(/SEQUENCE:(\d+)/.exec(b)![1]), Math.floor(later.getTime() / 1000));
  });

  test("ETag: un If-None-Match con el prefijo débil W/ también da 304", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await makeTask(f, { dueDate: inDays(4) });
    const { token } = await feedFor(user);
    const etag = (await fetchFeed(token)).res.headers.get("etag")!;
    assert.equal((await fetchFeed(token, undefined, { "if-none-match": `W/${etag}` })).res.status, 304);
    assert.equal((await fetchFeed(token, undefined, { "if-none-match": `"otro", W/${etag}` })).res.status, 304);
    assert.equal((await fetchFeed(token, undefined, { "if-none-match": 'W/"otro"' })).res.status, 200);
  });

  test("descripciones enormes: el calendario y el .ics de la columna Agenda recortan antes de convertir", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const huge = "**a ".repeat(60_000);
    const emojis = "😀".repeat(400);
    const t1 = await makeTask(f, { title: "Enorme", dueDate: inDays(2) });
    const t2 = await makeTask(f, { title: "Emojis", dueDate: inDays(3) });
    await db.task.update({ where: { id: t1.id }, data: { description: huge } });
    await db.task.update({ where: { id: t2.id }, data: { description: emojis } });
    await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega enorme", description: huge, position: 1, dueDate: inDays(4) } });
    const { token } = await feedFor(user);
    const t0 = performance.now();
    const { res, text } = await fetchFeed(token);
    assert.ok(performance.now() - t0 < 2000);
    assert.equal(res.status, 200);
    const unfolded = text.replace(/\r\n /g, "");
    const desc = (id: string) => /DESCRIPTION:(.*)\r\n/.exec(unfolded.split("BEGIN:VEVENT").find((b) => b.includes(id))!)![1]!;
    assert.ok(desc(t1.id).length < 700, "descripción acotada");
    // El recorte a 300 caracteres no parte ningún emoji.
    const emojiDesc = desc(t2.id);
    assert.ok(emojiDesc.endsWith("😀…"));
    assert.ok(!emojiDesc.includes("�"));
    assert.equal(Array.from(emojiDesc.split("\\n").at(-1)!).length, 300);

    // Columna Agenda: la descripción del .ics se recorta a 1500 caracteres antes de convertirla.
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "AGENDA" } });
    const t3 = performance.now();
    const col = await buildColumnIcs(f.project.id, f.columns.todo);
    assert.ok(performance.now() - t3 < 2000);
    assert.ok(col);
    const colDesc = /DESCRIPTION:(.*)\r\n/.exec(col.ics.replace(/\r\n /g, "").split("BEGIN:VEVENT").find((b) => b.includes(t1.id))!)![1]!;
    assert.ok(colDesc.length <= 1600);
  });

  test("si la ruta falla: 500 genérico y el error se registra sin el token", async () => {
    const user = await makeUser();
    const { token } = await feedFor(user);
    // La consulta del token falla (BD caída…): se sustituye el acceso a la tabla en el cliente, que solo existe durante la prueba.
    const real = db.calendarFeed;
    Object.defineProperty(db, "calendarFeed", {
      configurable: true,
      value: new Proxy(real, {
        get: (target, prop, receiver) =>
          prop === "findFirst" ? async () => { throw new Error(`conexión perdida resolviendo /api/calendar/${token}.ics (${token})`); } : Reflect.get(target, prop, receiver),
      }),
    });
    try {
      const { res, text } = await fetchFeed(token);
      assert.equal(res.status, 500);
      assert.equal(text, "Internal error");
      assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    } finally {
      Object.defineProperty(db, "calendarFeed", { configurable: true, value: real });
    }
    await flushLogs();
    const rows = await db.appLog.findMany({ where: { action: "calendar.feedFailed" }, orderBy: { createdAt: "desc" }, take: 1 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.level, "error");
    assert.equal(rows[0]!.path, "/api/calendar/…");
    assert.ok(!JSON.stringify(rows[0]).includes(token), "el token no está en el registro");
    assert.match(rows[0]!.message, /conexión perdida/);
    // Sin el fallo, el mismo enlace sigue sirviendo.
    assert.equal((await fetchFeed(token)).res.status, 200);
  });

  test("onRequestError no deja tokens (calendario, /reset/, /confirm/) en Administración → Logs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const secret = "tok" + "A1b2C3d4E5f6".repeat(3);
    const cases = [`/api/calendar/${secret}.ics`, `/api/calendar/${secret}`, `/reset/${secret}`, `/confirm/${secret}`, `/api/calendar/${secret}.ics?x=1`];
    for (const path of cases) {
      const err = Object.assign(new Error(`boom ${secret} en ${path}`), { stack: `Error: boom ${secret}\n    at ${path}` });
      await onRequestError(err, { path, method: "GET" }, { routerKind: "App Router", routePath: "/x/[token]", routeType: "route" });
    }
    // Una ruta normal se registra tal cual.
    await onRequestError(new Error("otro"), { path: "/p/abc?task=1", method: "GET" }, { routerKind: "App Router", routePath: "/p/[id]", routeType: "render" });
    await flushLogs();
    const rows = await db.appLog.findMany({ where: { action: "system.uncaughtError" }, orderBy: { createdAt: "desc" }, take: cases.length + 1 });
    assert.equal(rows.length, cases.length + 1);
    assert.deepEqual(rows.map((r) => r.path).sort(), ["/api/calendar/…", "/api/calendar/…", "/api/calendar/…", "/confirm/…", "/p/abc?task=1", "/reset/…"].sort());
    for (const r of rows) assert.ok(!JSON.stringify(r).includes(secret), `filtrado en ${r.path}: ${r.message}`);
    assert.ok(rows.some((r) => r.path === "/p/abc?task=1" && r.message.includes("otro")));
  });
});
