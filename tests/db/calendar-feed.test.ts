// Suscripción al calendario (.ics vivo) contra PostgreSQL real: token, permisos, regeneración y límite de ritmo.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { calendarFeedUsage, createCalendarFeed, disableCalendarFeed, setCalendarFeedScope, suggestedCalendarFeedScope } from "../../src/actions/calendar-feed";
import { GET } from "../../src/app/api/calendar/[file]/route";
import { onRequestError } from "../../src/instrumentation";
import { createProject, removeProjectMember } from "../../src/actions/projects";
import { cachedFeedIcs, defaultFeedScope, EMPTY_FEED_ICS, FEED_CACHE_MAX, FEED_CACHE_MAX_BYTES, FEED_CACHE_MS, feedCacheForTests, feedMaxAgeSec, resolveFeedToken } from "../../src/lib/calendar-feed";
import { revokeUser } from "../../src/lib/revoke";
import pg from "pg";
import { buildColumnIcs } from "../../src/lib/column-views";
import { flushLogs } from "../../src/lib/log";
import { appTimeZone } from "../../src/lib/board";
import { dateToIso, isoWeekday, todayIso } from "../../src/lib/dates";
import { firstOccurrence } from "../../src/lib/recurrence-series";
import { FEED_MAX_REPEATS } from "../../src/lib/calendar-feed-core";
import { seedBuiltinTemplates } from "../../src/lib/template-store";
import { makeT } from "../../src/i18n/core";

let n = 0;
/**
 * Pide la suscripción como lo haría un cliente de calendario (sin sesión), desde una IP propia de cada llamada. Salvo con
 * `cached`, vacía antes la memoria del calendario (cachedFeedIcs) para ver el efecto de cada cambio al momento.
 */
async function fetchFeed(token: string, ip = `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`, headers: Record<string, string> = {}, cached = false) {
  if (!cached) feedCacheForTests.clear();
  const res = await GET(new Request(`https://app.example.com/api/calendar/${token}.ics`, { headers: { "x-real-ip": ip, ...headers } }), { params: Promise.resolve({ file: `${token}.ics` }) });
  return { res, text: await res.text() };
}

/** Respuesta a un enlace con forma válida que no vale: el mismo calendario vacío para todos (sin eventos ni datos de nadie). */
function assertEmptyFeed(r: { res: Response; text: string }, what = "") {
  assert.equal(r.res.status, 200, what);
  assert.equal(r.res.headers.get("content-type"), "text/calendar; charset=utf-8", what);
  assert.equal(r.text, EMPTY_FEED_ICS, what);
  assert.ok(!r.text.includes("BEGIN:VEVENT"), what);
  assert.ok(r.text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && r.text.endsWith("END:VCALENDAR\r\n"), `${what}: .ics válido`);
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
    assertEmptyFeed(await fetchFeed(a.token), "regenerado");
    assert.equal((await fetchFeed(b.token)).res.status, 200);
    expectOk(await disableCalendarFeed());
    assertEmptyFeed(await fetchFeed(b.token), "desactivado");
    assert.equal(await db.calendarFeed.count({ where: { userId: user.id } }), 0);
    const c = await feedFor(user);
    assert.equal((await fetchFeed(c.token)).res.status, 200);
    assertEmptyFeed(await fetchFeed(b.token), "desactivado y luego otro nuevo");
  });

  test("un enlace con forma válida que no vale da el mismo calendario vacío (exista o no); otra forma, 404", async () => {
    const user = await makeUser({ name: "Persona Calendario Vacío" });
    const f = await makeProject({ members: [user] });
    await makeTask(f, { title: "Tarea que no debe salir", dueDate: inDays(3) });
    const live = await feedFor(user);
    const before = await fetchFeed(live.token);
    assert.ok(before.text.includes("BEGIN:VEVENT"));
    expectOk(await disableCalendarFeed());
    // El que existió y uno inventado: misma respuesta, cabeceras incluidas (no se sabe cuál existió).
    const revoked = await fetchFeed(live.token);
    const invented = await fetchFeed("x".repeat(43));
    for (const [what, r] of [["desactivado", revoked], ["inventado", invented]] as const) {
      assertEmptyFeed(r, what);
      for (const leak of [user.name, f.project.name, "Tarea que no debe salir", live.token]) assert.ok(!r.text.includes(leak), `${what}: ${leak}`);
    }
    const headersOf = (r: { res: Response }) => [...r.res.headers.entries()].filter(([k]) => k !== "date").sort();
    assert.deepEqual(headersOf(revoked), headersOf(invented));
    assert.match(revoked.text, /^X-WR-CALNAME:Pizarro\r$/m, "nombre genérico");
    // Con su ETag, 304 (también es el mismo para todos).
    assert.equal((await fetchFeed("y".repeat(43), undefined, { "if-none-match": revoked.res.headers.get("etag")! })).res.status, 304);
    // Otra forma: 404 genérico.
    const seen = [];
    for (const tok of ["corto", "a".repeat(200), "x".repeat(42) + "!"]) {
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
    assertEmptyFeed(await fetchFeed(a.token), "usuario desactivado");
    await db.user.update({ where: { id: inactive.id }, data: { active: true } });
    assert.equal((await fetchFeed(a.token)).res.status, 200);

    const gone = await makeUser();
    const b = await feedFor(gone);
    assert.equal((await fetchFeed(b.token)).res.status, 200);
    await db.user.delete({ where: { id: gone.id } });
    assertEmptyFeed(await fetchFeed(b.token), "usuario borrado");
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

  test("ámbito por defecto: «Todas» si las tareas de sus proyectos no suelen tener responsable («Casa y familia» con ejemplos)", async () => {
    // Uso familiar: proyecto privado desde la plantilla con tarjetas de ejemplo, que no tienen responsable. Antes salía
    // marcado «Solo las mías» y la suscripción quedaba vacía.
    const parent = await makeUser();
    await loginAs(parent);
    await db.builtinTemplateSeeded.deleteMany({ where: { key: "casa-familia" } });
    await db.projectTemplate.deleteMany({ where: { builtinKey: "casa-familia" } });
    await seedBuiltinTemplates(db);
    const homeTemplate = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "casa-familia" } });
    const home = expectOk(await createProject("Casa", { templateId: homeTemplate.id, withExamples: true, isPrivate: true }));
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

  test("«Suscribirse» pide la opción propuesta al abrirse (no en cada visita al Calendario): la guardada o la de por defecto", async () => {
    const dev = await makeUser();
    const f = await makeProject({ members: [dev] });
    await db.task.update({ where: { id: (await makeTask(f)).id }, data: { assigneeId: dev.id } });
    await loginAs(dev);
    assert.equal(expectOk(await suggestedCalendarFeedScope()), "MINE", "sin suscripción, defaultFeedScope");
    await feedFor(dev, "ALL");
    assert.equal(expectOk(await suggestedCalendarFeedScope()), "ALL", "con suscripción, la suya");
  });

  test("«Último uso»: sin usar al generarlo, se anota al consultarlo, vuelve a «sin usar» al regenerar y desaparece al desactivar", async () => {
    const user = await makeUser();
    await loginAs(user);
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: false, lastUsedAt: null });
    const a = await feedFor(user);
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: true, lastUsedAt: null });
    const before = Date.now();
    assert.equal((await fetchFeed(a.token)).res.status, 200);
    // La ruta lo escribe sin esperar a la respuesta.
    let used: string | null = null;
    for (let i = 0; i < 50 && !used; i++) {
      used = expectOk(await calendarFeedUsage()).lastUsedAt;
      if (!used) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(used && Date.parse(used) >= before - 1000, "anotado al consultarlo");
    // Solo el de quien pregunta.
    await loginAs(await makeUser());
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: false, lastUsedAt: null });
    await feedFor(user);
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: true, lastUsedAt: null }, "el enlace nuevo aún no se ha usado");
    expectOk(await disableCalendarFeed());
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: false, lastUsedAt: null });
  });

  test("«Último uso»: una consulta con el enlace anterior que termina después de regenerarlo no lo anota en el nuevo", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await makeTask(f, { dueDate: inDays(3) });
    const old = await feedFor(user);
    // Con «Task» bloqueada, la consulta con el enlace anterior ya lo ha validado y se queda montando el .ics.
    let release!: () => void;
    const locked = new Promise<void>((resolve) => (release = resolve));
    let lockedReady!: () => void;
    const ready = new Promise<void>((r) => (lockedReady = r));
    const lockTx = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "Task" IN ACCESS EXCLUSIVE MODE`);
      lockedReady();
      await locked;
    }, { timeout: 30_000 });
    let pending: ReturnType<typeof fetchFeed> | undefined;
    try {
      await ready;
      pending = fetchFeed(old.token);
      await waitForLockWaiter();
      await feedFor(user); // regenerar mientras tanto
    } finally {
      release();
      await lockTx;
    }
    assert.equal((await pending!).res.status, 200);
    await new Promise((r) => setTimeout(r, 300)); // la ruta lo escribe sin esperar a la respuesta
    await loginAs(user);
    assert.deepEqual(expectOk(await calendarFeedUsage()), { active: true, lastUsedAt: null }, "el enlace nuevo sigue «sin usar»");
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

  test("registro muestreado: una línea por enlace e IP cada 6 h; otra IP, un enlace revocado y el exceso de ritmo sí se anotan", async () => {
    const user = await makeUser();
    const { token } = await feedFor(user);
    const since = new Date();
    const rows = async (action: string) => {
      await flushLogs();
      return db.appLog.findMany({ where: { action, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });
    };
    for (let i = 0; i < 5; i++) assert.equal((await fetchFeed(token, "10.6.6.1")).res.status, 200);
    let ok = (await rows("calendar.feed")).filter((r) => r.userId === user.id);
    assert.equal(ok.length, 1, "cinco consultas seguidas desde la misma IP: una sola línea");
    // Desde otra dirección (p. ej. el enlace usado en otro sitio): se anota enseguida.
    assert.equal((await fetchFeed(token, "10.6.6.2")).res.status, 200);
    ok = (await rows("calendar.feed")).filter((r) => r.userId === user.id);
    assert.deepEqual(ok.map((r) => r.ip), ["10.6.6.1", "10.6.6.2"]);
    assert.ok(!JSON.stringify(ok).includes(token), "el token nunca va al registro");
    // Enlace regenerado que el calendario sigue pidiendo: se anota (una vez por IP y periodo), sin el token.
    const fresh = await feedFor(user);
    for (let i = 0; i < 3; i++) assertEmptyFeed(await fetchFeed(token, "10.6.6.3"));
    const rejected = (await rows("calendar.feedRejected")).filter((r) => r.ip === "10.6.6.3");
    assert.equal(rejected.length, 1);
    assert.ok(!JSON.stringify(rejected).includes(token));
    // Exceso de ritmo: aviso (uno por hora y enlace e IP, aunque sigan llegando).
    let status = 200;
    for (let i = 0; i < 35; i++) status = (await fetchFeed(fresh.token, "10.6.6.4")).res.status;
    assert.equal(status, 429);
    const limited = (await rows("calendar.feedRateLimited")).filter((r) => r.ip === "10.6.6.4");
    assert.equal(limited.length, 1);
    assert.equal(limited[0]!.level, "warn");
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

describe("tareas que se repiten en el calendario suscrito", () => {
  /** Bloque VEVENT (desplegado) con ese UID, o undefined. */
  const block = (ics: string, uid: string) => ics.replace(/\r\n /g, "").split("BEGIN:VEVENT").find((b) => b.includes(`UID:${uid}\r\n`));
  const compact = (iso: string) => iso.replace(/-/g, "");

  test("una serie con RRULE por tarea pendiente con fecha; ni terminadas, ni archivadas, ni sin fecha, ni las que ya dieron la siguiente", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const today = todayIso(appTimeZone());
    const due = inDays(5);
    const weekly = await makeTask(f, { title: "Semanal", recurrence: "WEEKLY", dueDate: due });
    const wd = isoWeekday(dateToIso(due)!);
    await db.task.update({ where: { id: weekly.id }, data: { recurrenceDay: wd } });
    const done = await makeTask(f, { title: "Hecha", recurrence: "DAILY", dueDate: inDays(3), columnId: f.columns.done });
    const archived = await makeTask(f, { title: "Archivada", recurrence: "DAILY", dueDate: inDays(3) });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const undated = await makeTask(f, { title: "Sin fecha", recurrence: "DAILY" });
    // Vencida hace 200 días (fuera de la ventana del calendario): la tarea no sale, pero su serie sí, desde mañana.
    const overdue = await makeTask(f, { title: "Vencida", recurrence: "DAILY", dueDate: inDays(-200) });
    // Una que ya dio su siguiente aparición (aún abierta): la serie sale de la nueva, no de las dos.
    const old = await makeTask(f, { title: "Anterior", recurrence: "DAILY", dueDate: inDays(1) });
    const next = await makeTask(f, { title: "Siguiente", recurrence: "DAILY", dueDate: inDays(2) });
    await db.task.update({ where: { id: next.id }, data: { recurrenceFromId: old.id } });
    // Mensual el día 30: sin RRULE fiel, un evento por mes.
    const m30 = await makeTask(f, { title: "Cierre", recurrence: "MONTHLY", dueDate: inDays(4) });
    await db.task.update({ where: { id: m30.id }, data: { recurrenceDay: 30 } });

    const { token } = await feedFor(user);
    const { res, text } = await fetchFeed(token);
    assert.equal(res.status, 200);
    const serie = block(text, `${weekly.id}-repeat@pizarro`);
    assert.ok(serie, "serie semanal");
    const first = firstOccurrence("WEEKLY", wd, dateToIso(due), today)!;
    assert.ok(serie.includes(`DTSTART;VALUE=DATE:${compact(first)}\r\n`));
    assert.ok(serie.includes(`RRULE:FREQ=WEEKLY;BYDAY=${["MO", "TU", "WE", "TH", "FR", "SA", "SU"][wd - 1]}\r\n`));
    assert.ok(serie.includes(`SUMMARY:[${f.project.name}] Semanal\r\n`));
    assert.ok(serie.includes(`/p/${f.project.id}?task=${weekly.id}`), "abre la tarea original");
    assert.match(serie, /DESCRIPTION:Repetición prevista \(Cada semana \(.+\)\): se crea al terminar la anterior\./);
    // La tarea en sí sigue con su propio evento, sin RRULE.
    assert.ok(!block(text, `${weekly.id}@pizarro`)!.includes("RRULE"));

    for (const id of [done.id, archived.id, undated.id, old.id]) assert.equal(block(text, `${id}-repeat@pizarro`), undefined, id);
    assert.ok(block(text, `${next.id}-repeat@pizarro`));
    assert.equal(block(text, `${overdue.id}@pizarro`), undefined);
    assert.ok(block(text, `${overdue.id}-repeat@pizarro`)!.includes(`DTSTART;VALUE=DATE:${compact(firstOccurrence("DAILY", null, dateToIso(inDays(-200)), today)!)}`));

    const monthly = text.match(new RegExp(`UID:${m30.id}-repeat-\\d{4}-\\d{2}-\\d{2}@pizarro`, "g")) ?? [];
    assert.ok(monthly.length >= 11 && monthly.length <= 13, `eventos mensuales: ${monthly.length}`);
    assert.equal(text.split("\r\n").filter((l) => l.startsWith("RRULE:")).length, 3, "semanal, siguiente y vencida");
  });

  test("«Solo las mías»: solo las series de las tareas asignadas a la persona", async () => {
    const user = await makeUser();
    const mate = await makeUser();
    const f = await makeProject({ members: [user, mate] });
    const mine = await makeTask(f, { title: "Mía", recurrence: "DAILY", dueDate: inDays(2) });
    const theirs = await makeTask(f, { title: "Suya", recurrence: "DAILY", dueDate: inDays(2) });
    await db.task.update({ where: { id: mine.id }, data: { assigneeId: user.id } });
    await db.task.update({ where: { id: theirs.id }, data: { assigneeId: mate.id } });
    const { token } = await feedFor(user, "MINE");
    const { text } = await fetchFeed(token);
    assert.ok(block(text, `${mine.id}-repeat@pizarro`));
    assert.equal(block(text, `${theirs.id}-repeat@pizarro`), undefined);
  });

  test(".ics de la columna Agenda: la serie de cada tarea que se repite (con la nota si se pasa el idioma)", async () => {
    const f = await makeProject();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "AGENDA" } });
    const t = await makeTask(f, { title: "Riego", recurrence: "MONTHLY", dueDate: inDays(3) });
    await db.task.update({ where: { id: t.id }, data: { recurrenceDay: 31 } });
    const col = await buildColumnIcs(f.project.id, f.columns.todo);
    assert.ok(col);
    const serie = block(col.ics, `${t.id}-repeat@pizarro`);
    assert.ok(serie?.includes("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1\r\n"));
    assert.ok(block(col.ics, `${t.id}@pizarro`));
    assert.ok(!serie!.includes("Repetición prevista"));
    const en = await buildColumnIcs(f.project.id, f.columns.todo, { t: makeT("en"), locale: "en" });
    assert.match(block(en!.ics, `${t.id}-repeat@pizarro`)!, /DESCRIPTION:Upcoming repeat \(Every month \(day 31\)\)/);
    // En una columna Agenda que cuenta como terminada no hay serie.
    await db.column.update({ where: { id: f.columns.todo }, data: { isDone: true } });
    assert.equal(block((await buildColumnIcs(f.project.id, f.columns.todo))!.ics, `${t.id}-repeat@pizarro`), undefined);
  });

  test(".ics de la columna Agenda: las series no multiplican descripciones largas ni pasan del tope de tareas que se repiten", async () => {
    const f = await makeProject();
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "AGENDA" } });
    // Mensual el día 30 (sin RRULE fiel): un evento por mes, y cada uno repetía la descripción de la tarea (hasta 1.500
    // caracteres): con 2.000 tareas así, unos 80 MB por petición.
    const long = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(" ");
    const m30 = await makeTask(f, { title: "Cierre", recurrence: "MONTHLY", dueDate: inDays(4) });
    await db.task.update({ where: { id: m30.id }, data: { recurrenceDay: 30, description: long } });
    const col = (await buildColumnIcs(f.project.id, f.columns.todo))!;
    const unfolded = col.ics.replace(/\r\n /g, "");
    const events = unfolded.split("BEGIN:VEVENT").filter((b) => new RegExp(`UID:${m30.id}-repeat-\\d{4}-\\d{2}-\\d{2}@pizarro`).test(b));
    assert.ok(events.length >= 11, `eventos mensuales: ${events.length}`);
    // La tarea conserva su descripción (hasta 1.500 caracteres); las apariciones previstas, un extracto (como la suscripción).
    assert.ok(block(unfolded, `${m30.id}@pizarro`)!.includes("palabra100 "), "descripción larga en la tarea");
    for (const e of events) {
      const desc = /DESCRIPTION:(.*)/.exec(e)?.[1] ?? "";
      assert.ok(desc.startsWith("palabra0 ") && desc.length <= 320, `descripción de la aparición: ${desc.length}`);
    }

    // Muchas tareas que se repiten: solo las primeras FEED_MAX_REPEATS llevan serie (como la suscripción).
    const many = FEED_MAX_REPEATS + 20;
    await db.task.createMany({
      data: Array.from({ length: many }, (_, i) => ({
        projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `Diaria ${i}`, position: 10_000 + i, recurrence: "DAILY" as const, dueDate: inDays(10),
      })),
    });
    const big = (await buildColumnIcs(f.project.id, f.columns.todo))!;
    const series = big.ics.split("\r\n").filter((l) => /^UID:.+-repeat(-\d{4}-\d{2}-\d{2})?@pizarro$/.test(l));
    const sources = new Set(series.map((l) => l.replace(/-repeat.*$/, "")));
    assert.equal(sources.size, FEED_MAX_REPEATS);
    assert.equal(big.count, many + 1);
  });
});

/** Cuenta las consultas SQL y los bytes que devuelven mientras corre `fn`. */
async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[]; bytes: number }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  const sql: string[] = [];
  let bytes = 0;
  proto.query = function (this: unknown, ...args: unknown[]) {
    const q = args[0];
    sql.push(typeof q === "string" ? q : String((q as { text?: string } | undefined)?.text ?? ""));
    const out = orig.apply(this, args);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      return (out as Promise<{ rows?: unknown[] }>).then((res) => {
        if (res?.rows?.length) bytes += JSON.stringify(res.rows).length;
        return res;
      });
    }
    return out;
  };
  try {
    return { result: await fn(), sql, bytes };
  } finally {
    proto.query = orig;
  }
}

describe("memoria del calendario suscrito", () => {
  test("una segunda consulta antes de un minuto no rehace el calendario: solo comprueba el enlace", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f, { title: "Primera", dueDate: inDays(3) });
    const { token } = await feedFor(user);
    feedCacheForTests.clear();
    const first = await fetchFeed(token, "10.5.5.1", {}, true);
    assert.equal(first.res.status, 200);
    assert.ok(first.text.includes(task.id));
    const later = await makeTask(f, { title: "Segunda", dueDate: inDays(4) });
    const again = await countQueries(() => fetchFeed(token, "10.5.5.1", {}, true));
    assert.equal(again.result.res.status, 200);
    // Solo la comprobación del token (el enlace y su persona; si acaso, la anotación del último uso que lanzó la primera).
    const reads = again.sql.filter((s) => /^\s*SELECT/i.test(s));
    assert.ok(reads.length >= 1 && reads.length <= 2, reads.join("\n"));
    for (const s of reads) assert.match(s, /FROM "public"\."(CalendarFeed|User)"/);
    assert.ok(!again.sql.some((s) => /"Task"|"Deliverable"|"Project"/.test(s)), "no rehace el calendario");
    assert.equal(again.result.text, first.text, "el mismo calendario, ya hecho");
    assert.equal(again.result.res.headers.get("etag"), first.res.headers.get("etag"));
    // Con el mismo ETag, 304 también desde la memoria.
    const notModified = await fetchFeed(token, "10.5.5.1", { "if-none-match": first.res.headers.get("etag")! }, true);
    assert.equal(notModified.res.status, 304);
    // Pasado el minuto (aquí, vaciando la memoria) se rehace y aparece la nueva.
    assert.ok((await fetchFeed(token)).text.includes(later.id));
  });

  test("un enlace regenerado o desactivado da el calendario vacío aunque el suyo siga en la memoria", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await makeTask(f, { dueDate: inDays(2) });
    const a = await feedFor(user);
    feedCacheForTests.clear();
    assert.equal((await fetchFeed(a.token, undefined, {}, true)).res.status, 200);
    const b = await feedFor(user);
    assertEmptyFeed(await fetchFeed(a.token, undefined, {}, true));
    assert.equal((await fetchFeed(b.token, undefined, {}, true)).res.status, 200);
    expectOk(await disableCalendarFeed());
    assertEmptyFeed(await fetchFeed(b.token, undefined, {}, true));
    // Usuario desactivado: también.
    const c = await feedFor(user);
    assert.equal((await fetchFeed(c.token, undefined, {}, true)).res.status, 200);
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    assertEmptyFeed(await fetchFeed(c.token, undefined, {}, true));
  });

  test("consultas simultáneas del mismo enlace comparten la generación; caduca al minuto; el alcance cambia la clave", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await makeTask(f, { dueDate: inDays(2) });
    const { token } = await feedFor(user, "ALL");
    feedCacheForTests.clear();
    const feed = (await resolveFeedToken(token))!;
    const t0 = Date.now();
    const [x, y, z] = await Promise.all([cachedFeedIcs(feed, t0), cachedFeedIcs(feed, t0), cachedFeedIcs(feed, t0 + 1000)]);
    assert.ok(x === y && y === z, "una sola generación");
    assert.notEqual(await cachedFeedIcs(feed, t0 + FEED_CACHE_MS), x, "caducado: se rehace");
    expectOk(await setCalendarFeedScope("MINE"));
    const mine = (await resolveFeedToken(token))!;
    assert.equal(mine.scope, "MINE");
    assert.notEqual(await cachedFeedIcs(mine), x);
  });

  test(`tope de ${FEED_CACHE_MAX} enlaces: se olvida el usado hace más tiempo`, async () => {
    const user = await makeUser();
    const { token } = await feedFor(user);
    const real = (await resolveFeedToken(token))!;
    feedCacheForTests.clear();
    const fake = (i: number) => ({ ...real, tokenHash: `fake-${i}` });
    const first = await cachedFeedIcs(fake(0));
    const second = await cachedFeedIcs(fake(1));
    for (let i = 2; i < FEED_CACHE_MAX; i++) await cachedFeedIcs(fake(i));
    assert.equal(feedCacheForTests.size(), FEED_CACHE_MAX);
    // Usar el 0 lo pone al día; al entrar uno más sale el 1, el más antiguo sin usar.
    assert.equal(await cachedFeedIcs(fake(0)), first);
    await cachedFeedIcs(fake(FEED_CACHE_MAX));
    assert.equal(feedCacheForTests.size(), FEED_CACHE_MAX);
    assert.equal(await cachedFeedIcs(fake(0)), first);
    assert.notEqual(await cachedFeedIcs(fake(1)), second);
    feedCacheForTests.clear();
  });

  test("quitar a alguien de un proyecto o desactivar a una persona vacía la memoria: el calendario cambia al momento", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const user = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: admin, members: [admin, user] });
    const task = await makeTask(f, { title: "Del proyecto", dueDate: inDays(3) });
    const { token } = await feedFor(user);
    feedCacheForTests.clear();
    assert.ok((await fetchFeed(token, undefined, {}, true)).text.includes(task.id));
    assert.equal(feedCacheForTests.size(), 1);
    await loginAs(admin);
    expectOk(await removeProjectMember(f.project.id, user.id));
    assert.equal(feedCacheForTests.size(), 0, "revokeProject vacía la memoria del calendario");
    assert.ok(!(await fetchFeed(token, undefined, {}, true)).text.includes(task.id), "sin esperar al minuto");
    assert.equal(feedCacheForTests.size(), 1);
    revokeUser(user.id);
    assert.equal(feedCacheForTests.size(), 0, "revokeUser también");
  });

  test("Cache-Control: lo que le queda en la memoria del servidor (como mucho un minuto entre las dos)", async () => {
    assert.equal(feedMaxAgeSec(1_000_000, 1_000_000), FEED_CACHE_MS / 1000);
    assert.equal(feedMaxAgeSec(1_000_000, 1_000_000 + 15_500), Math.floor((FEED_CACHE_MS - 15_500) / 1000));
    assert.equal(feedMaxAgeSec(1_000_000, 1_000_000 + FEED_CACHE_MS + 5), 0);
    // Reloj hacia atrás: nunca más de un minuto.
    assert.equal(feedMaxAgeSec(1_000_000, 900_000), FEED_CACHE_MS / 1000);
    assert.ok(FEED_CACHE_MS <= 60_000);
    const user = await makeUser();
    const { token } = await feedFor(user);
    feedCacheForTests.clear();
    const first = await fetchFeed(token, undefined, {}, true);
    const maxAge = Number(/max-age=(\d+)/.exec(first.res.headers.get("cache-control") ?? "")?.[1]);
    assert.ok(maxAge >= FEED_CACHE_MS / 1000 - 2 && maxAge <= FEED_CACHE_MS / 1000, `max-age=${maxAge}`);
  });

  test("la memoria guarda el .ics en UTF-8, cuenta sus bytes y no pasa del tope", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await makeTask(f, { title: "Reunión – café ☕", dueDate: inDays(2) });
    const { token } = await feedFor(user);
    feedCacheForTests.clear();
    const { text } = await fetchFeed(token, undefined, {}, true);
    assert.ok(text.includes("Reunión – café ☕"), "el texto llega bien");
    assert.equal(feedCacheForTests.bytes(), Buffer.byteLength(text, "utf8"));
    assert.ok(FEED_CACHE_MAX_BYTES >= 16 * 1024 * 1024 && FEED_CACHE_MAX_BYTES <= 256 * 1024 * 1024);
    feedCacheForTests.clear();
    assert.equal(feedCacheForTests.bytes(), 0);
  });

  test("descripciones largas: solo se lee su comienzo de la base", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const t1 = await makeTask(f, { title: "Larga", dueDate: inDays(2), recurrence: "WEEKLY" });
    const long = `Inicio de la descripción. ${"palabra ".repeat(40_000)}`;
    await db.task.update({ where: { id: t1.id }, data: { description: long } });
    await db.deliverable.create({ data: { projectId: f.project.id, name: "Entrega larga", description: long, position: 1, dueDate: inDays(3) } });
    const { token } = await feedFor(user);
    const m = await countQueries(() => fetchFeed(token));
    assert.equal(m.result.res.status, 200);
    const unfolded = m.result.text.replace(/\r\n /g, "");
    assert.ok(unfolded.includes("Inicio de la descripción. palabra"));
    assert.ok(m.bytes < 40_000, `leídos ${m.bytes} bytes con descripciones de ${long.length}`);
    // .ics de la columna Agenda: tampoco lee la descripción entera, y lleva LAST-MODIFIED y SEQUENCE como la suscripción.
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "AGENDA" } });
    const col = await countQueries(() => buildColumnIcs(f.project.id, f.columns.todo));
    assert.ok(col.result);
    assert.ok(col.bytes < 40_000, `columna: leídos ${col.bytes} bytes con descripciones de ${long.length}`);
    const colUnfolded = col.result.ics.replace(/\r\n /g, "");
    assert.ok(colUnfolded.includes("Inicio de la descripción. palabra"));
    const own = colUnfolded.split("BEGIN:VEVENT").find((b) => b.includes(`UID:${t1.id}@pizarro`))!;
    const serie = colUnfolded.split("BEGIN:VEVENT").find((b) => b.includes(`UID:${t1.id}-repeat@pizarro`))!;
    for (const block of [own, serie]) {
      assert.match(block, /\r\nLAST-MODIFIED:\d{8}T\d{6}Z\r\n/);
      assert.match(block, /\r\nSEQUENCE:\d+\r\n/);
    }
  });
});
